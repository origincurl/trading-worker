import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { AccessTokenCacheService } from '@external/brokerage/auth/access-token-cache.service';
import { CredentialSourceService } from '@external/brokerage/credential/credential-source.service';
import { CredentialUsageService } from '@external/brokerage/credential/credential-usage.service';
import { KiwoomWsClient } from '@external/brokerage/platforms/kiwoom/kiwoom-ws.client';
import { dispatchExecutionFrame } from '@roles/tracker/mapper/kiwoom-order-fill.event-mapper';
import {
  TrackerWsOwnershipService,
  type TrackerWsLeaseSnapshot,
} from '@roles/tracker/service/tracker-ws-ownership.service';
import { IngestExecutionUsecase } from '@roles/tracker/usecase/ingest-execution.usecase';

interface ExecutionWsConnection {
  readonly key: string;
  readonly credentialId: number;
  readonly accountId: number;
  readonly accountExternalId: string;
  readonly client: KiwoomWsClient;
}

// Account-scoped execution WS manager. Each active account credential gets
// one Redis lease; only the lease owner opens the Kiwoom execution socket.
// Kiwoom publishes account-owned execution frames after LOGIN, so this path
// does not reuse collector market-data REG subscriptions.
@Injectable()
export class KiwoomExecutionSubscriber implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(KiwoomExecutionSubscriber.name);

  private readonly connections = new Map<string, ExecutionWsConnection>();

  private readonly backoffUntil = new Map<string, number>();

  private readonly failureCounts = new Map<string, number>();

  private readonly intentionalDisconnects = new Set<string>();

  private syncTimer: NodeJS.Timeout | null = null;

  private syncing = false;

  private readonly syncIntervalMs = readPositiveInt(
    process.env.TRACKER_EXECUTION_WS_SYNC_INTERVAL_MS,
    5_000,
  );

  private readonly loginAckTimeoutMs = readPositiveInt(
    process.env.TRACKER_EXECUTION_WS_LOGIN_ACK_TIMEOUT_MS,
    5_000,
  );

  private readonly backoffInitialMs = readPositiveInt(
    process.env.TRACKER_EXECUTION_WS_BACKOFF_INITIAL_MS,
    5_000,
  );

  private readonly backoffMaxMs = readPositiveInt(
    process.env.TRACKER_EXECUTION_WS_BACKOFF_MAX_MS,
    60_000,
  );

  constructor(
    private readonly ownership: TrackerWsOwnershipService,
    private readonly tokenCache: AccessTokenCacheService,
    private readonly source: CredentialSourceService,
    private readonly usage: CredentialUsageService,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    private readonly usecase: IngestExecutionUsecase,
  ) {}

  isConnected(): boolean {
    return this.connections.size > 0;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!executionWsEnabled()) {
      this.logger.warn('execution WS disabled (set TRACKER_EXECUTION_WS_ENABLED=true to enable)');

      return;
    }

    await this.syncConnections().catch((err) => this.warnSync(err));

    this.syncTimer = setInterval(() => {
      this.syncConnections().catch((err) => this.warnSync(err));
    }, this.syncIntervalMs);

    this.logger.log(`execution WS sync every ${this.syncIntervalMs}ms`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);

      this.syncTimer = null;
    }

    await Promise.all([...this.connections.keys()].map((key) => this.disconnect(key, 'shutdown')));
  }

  private async syncConnections(): Promise<void> {
    if (this.syncing) return;

    this.syncing = true;
    try {
      const desired = new Map(
        this.ownership
          .snapshot()
          .filter((item) => item.owned)
          .map((item) => [this.connectionKey(item), item]),
      );

      for (const key of this.connections.keys()) {
        if (!desired.has(key)) {
          await this.disconnect(key, 'lease-lost');
        }
      }

      for (const [key, item] of desired) {
        if (!this.connections.has(key)) {
          const backoffMs = this.remainingBackoffMs(key);
          if (backoffMs > 0) {
            this.logger.debug(`execution WS connect skipped key=${key} backoffMs=${backoffMs}`);

            continue;
          }

          await this.connect(key, item).catch((err) => {
            this.recordConnectFailure(key, item, err);
          });
        }
      }
    } finally {
      this.syncing = false;
    }
  }

  private async connect(key: string, item: TrackerWsLeaseSnapshot): Promise<void> {
    const material = await this.source.selectAccountCredentialByApiCredential(
      item.accountId,
      item.credentialId,
    );
    if ((material.accountExternalId ?? '').trim() !== item.accountExternalId.trim()) {
      throw new DomainError(
        'tracker execution WS accountExternalId does not match active account credential',
        'TRACKER_EXECUTION_ACCOUNT_MISMATCH',
        {
          accountId: item.accountId,
          credentialId: item.credentialId,
        },
      );
    }
    const token = await this.tokenCache.getAccessToken(material);
    const client = new KiwoomWsClient({
      profile: 'executor',
      wsUrl: this.kiwoom.wsUrl,
      tokenSupplier: async () => ({
        token,
        credential: {
          kind: 'executor',
          credentialId: material.credentialId,
          accountId: item.accountId,
          origin: 'TRACKER_STATUS',
          priority: 'P1',
          actionType: 'WS',
          endpointType: 'WS_EXECUTION',
        },
        invalidate: () => this.tokenCache.invalidate(material.credentialId),
      }),
    });

    client.onMessage((parsed) => this.routeFrame(key, item, parsed, client));
    client.onClose((code, reason) => {
      this.connections.delete(key);
      const intentional = this.intentionalDisconnects.delete(key);
      if (intentional) return;

      this.recordConnectFailure(key, item, `unexpected close code=${code} reason=${reason}`);
    });

    try {
      await client.connect();
      await this.login(client, token, material.credentialId, item.accountId);
    } catch (err) {
      this.intentionalDisconnects.add(key);
      await client.disconnect(1000, 'connect-failed').catch(() => undefined);
      this.intentionalDisconnects.delete(key);

      throw err;
    }

    this.connections.set(key, {
      key,
      credentialId: item.credentialId,
      accountId: item.accountId,
      accountExternalId: item.accountExternalId,
      client,
    });
    this.clearConnectFailure(key);
    this.usage.markWsConnected('executor', this.usageContext(item), 0, []);
    this.logger.log(
      `execution WS connected credentialId=${item.credentialId} accountId=${item.accountId}`,
    );
  }

  private async disconnect(key: string, reason: string): Promise<void> {
    const existing = this.connections.get(key);
    if (!existing) return;

    this.connections.delete(key);
    try {
      this.intentionalDisconnects.add(key);
      await existing.client.disconnect(1000, reason);
    } catch (err) {
      this.logger.warn(
        `execution WS disconnect failed key=${key}: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.intentionalDisconnects.delete(key);
    }
    this.usage.markWsDisconnected(
      'executor',
      {
        kind: 'executor',
        credentialId: existing.credentialId,
        accountId: existing.accountId,
        origin: 'TRACKER_STATUS',
        priority: 'P1',
        actionType: 'WS',
        endpointType: 'WS_EXECUTION',
      },
      reason,
    );
  }

  private routeFrame(
    key: string,
    item: TrackerWsLeaseSnapshot,
    frame: unknown,
    client: KiwoomWsClient,
  ): void {
    if (!isPlainObject(frame)) {
      this.handleFrame(frame);

      return;
    }

    const trnm = frame.trnm;
    if (trnm === 'PING') {
      void client.send({ trnm: 'PING' }).catch((err) => {
        this.logger.warn(
          `execution WS PING ack failed: ${err instanceof Error ? err.message : err}`,
        );
      });

      return;
    }

    if (trnm === 'SYSTEM') {
      void this.handleSystemFrame(key, item, frame, client);

      return;
    }

    if (trnm === 'LOGIN' || trnm === 'REG' || trnm === 'REMOVE') return;

    this.handleFrame(frame);
  }

  private async handleSystemFrame(
    key: string,
    item: TrackerWsLeaseSnapshot,
    frame: Record<string, unknown>,
    client: KiwoomWsClient,
  ): Promise<void> {
    const code = typeof frame.code === 'string' ? frame.code : null;
    const message = typeof frame.message === 'string' ? frame.message : 'Kiwoom SYSTEM frame';
    const reason = `Kiwoom SYSTEM ${code ?? '<unknown>'}: ${message}`;

    this.logger.warn(`execution WS ${reason}`);
    if (code === 'R10001') {
      this.recordConnectFailure(key, item, reason);
      this.intentionalDisconnects.add(key);
      await client.disconnect(1000, 'system-session-conflict').catch(() => undefined);
      this.intentionalDisconnects.delete(key);
    }
  }

  private handleFrame(frame: unknown): void {
    const results = dispatchExecutionFrame(frame, {
      marketEnv: this.kiwoom.marketEnv,
      receivedAt: new Date(),
    });

    for (const result of results) {
      if (result.kind === 'fill') {
        this.usecase
          .execute(result.payload)
          .catch((err) =>
            this.logger.warn(
              `order-fill ingest failed: ${err instanceof Error ? err.message : err}`,
            ),
          );
      } else if (result.kind === 'dead-letter') {
        this.logger.warn(
          `execution dead-letter type=${result.realtimeType ?? 'null'} reason=${result.reason}`,
        );
      }
    }
  }

  private async login(
    client: KiwoomWsClient,
    token: string,
    credentialId: number,
    accountId: number,
  ): Promise<void> {
    const ack = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(`Kiwoom execution LOGIN ack timeout after ${this.loginAckTimeoutMs}ms`),
        );
      }, this.loginAckTimeoutMs);

      const unsubscribe = client.onMessage((parsed) => {
        if (!isPlainObject(parsed) || parsed.trnm !== 'LOGIN') return;

        clearTimeout(timeout);
        unsubscribe();

        const returnCode = parsed.return_code;
        if (returnCode === 0 || returnCode === '0') {
          resolve();

          return;
        }

        reject(
          new Error(
            `Kiwoom execution LOGIN failed credentialId=${credentialId} accountId=${accountId} returnCode=${String(
              returnCode,
            )}`,
          ),
        );
      });
    });

    await client.send({ trnm: 'LOGIN', token });
    await ack;
    await client.send({
      trnm: 'REG',
      grp_no: '1',
      refresh: '1',
      data: [{ item: [''], type: ['00'] }],
    });
  }

  private connectionKey(item: TrackerWsLeaseSnapshot): string {
    return `${item.marketEnv}:${item.credentialId}`;
  }

  private usageContext(item: TrackerWsLeaseSnapshot) {
    return {
      kind: 'executor' as const,
      credentialId: item.credentialId,
      accountId: item.accountId,
      origin: 'TRACKER_STATUS' as const,
      priority: 'P1' as const,
      actionType: 'WS' as const,
      endpointType: 'WS_EXECUTION',
    };
  }

  private warnSync(err: unknown): void {
    this.logger.warn(`execution WS sync failed: ${err instanceof Error ? err.message : err}`);
  }

  private remainingBackoffMs(key: string): number {
    const until = this.backoffUntil.get(key) ?? 0;

    return Math.max(0, until - Date.now());
  }

  private recordConnectFailure(
    key: string,
    item: TrackerWsLeaseSnapshot,
    err: unknown,
  ): void {
    const count = (this.failureCounts.get(key) ?? 0) + 1;
    const delayMs = Math.min(
      this.backoffMaxMs,
      this.backoffInitialMs * 2 ** Math.min(count - 1, 5),
    );
    const message = err instanceof Error ? err.message : String(err);

    this.failureCounts.set(key, count);
    this.backoffUntil.set(key, Date.now() + delayMs);
    this.usage.markWsDisconnected('executor', this.usageContext(item), message);
    this.logger.warn(
      `execution WS connect backoff key=${key} failures=${count} delayMs=${delayMs}: ${message}`,
    );
  }

  private clearConnectFailure(key: string): void {
    this.failureCounts.delete(key);
    this.backoffUntil.delete(key);
  }
}

function executionWsEnabled(): boolean {
  return process.env.TRACKER_EXECUTION_WS_ENABLED?.trim().toLowerCase() === 'true';
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
