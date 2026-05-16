import { Logger } from '@nestjs/common';
import { DomainError, IntegrationError, NotImplementedError } from '@common/error/domain.error';
import type { BrokerageGatewayProfile } from '../../brokerage.token';
import type {
  BrokerageGateway,
  CancelOrderInput,
  GetAccountBalanceInput,
  GetPositionsInput,
  MarketDataFrameHandler,
  MarketDataFrameKind,
  MarketDataSubscription,
  ModifyOrderInput,
  PlaceOrderInput,
  SubscribeMarketDataInput,
  UnsubscribeMarketDataInput,
} from '../../gateway/brokerage.gateway';
import type { AccountBalanceModel, PositionModel } from '../../model/account.model';
import type { OrderAckModel } from '../../model/order.model';
import type { KiwoomTokenService } from './auth/kiwoom-token.service';
import type { KiwoomApiClient } from './kiwoom.api-client';
import type { KiwoomWsClient } from './kiwoom-ws.client';

export interface KiwoomBrokerageGatewayOptions {
  readonly profile: BrokerageGatewayProfile;
  readonly apiClient: KiwoomApiClient;
  readonly wsClient: KiwoomWsClient;
  readonly tokenService: KiwoomTokenService;
  readonly loginAckTimeoutMs?: number;
  readonly postLoginDelayMs?: number;
  // Phase 6.8: backoff parameters for the gateway-level reconnect loop.
  // enabled=false reverts to Phase 6 (close = give up).
  readonly reconnect?: {
    readonly enabled: boolean;
    readonly initialDelayMs?: number;
    readonly maxDelayMs?: number;
    readonly maxAttempts?: number;
  };
}

const DEFAULT_LOGIN_ACK_TIMEOUT_MS = 5_000;
const DEFAULT_POST_LOGIN_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_RECONNECT_MAX_ATTEMPTS = 0; // 0 = unlimited

// Phase 6 market-data stream (collector-only) + Phase 6.8 auto-reconnect.
// Order paths remain throw-stubs until Phase 8 (executor internals).
//
// Frame-kind → Kiwoom realtime type:
//   trade-tick  → "0B"
//   orderbook   → "0D"
//
// Reconnect orchestrator: when WS closes unexpectedly (not via
// disconnectMarketDataStream), the gateway retries connect → LOGIN → REG
// with exponential backoff. The subscriptions map survives the socket
// so REG replay is automatic.
export class KiwoomBrokerageGateway implements BrokerageGateway {
  private readonly logger: Logger;

  private readonly subscriptions = new Map<string, Set<MarketDataFrameKind>>();

  private loggedIn = false;

  private userInitiatedDisconnect = false;

  private frameHandler: MarketDataFrameHandler | null = null;

  private reconnectAttempts = 0;

  private reconnecting = false;

  constructor(private readonly opts: KiwoomBrokerageGatewayOptions) {
    this.logger = new Logger(`KiwoomBrokerageGateway[${opts.profile}]`);
  }

  get profile(): BrokerageGatewayProfile {
    return this.opts.profile;
  }

  async getAccountBalance(input: GetAccountBalanceInput): Promise<AccountBalanceModel> {
    this.assertProfile('collector', 'getAccountBalance');

    throw new NotImplementedError('getAccountBalance not implemented', {
      profile: this.opts.profile,
      accountId: input.accountId,
    });
  }

  async getPositions(input: GetPositionsInput): Promise<PositionModel[]> {
    this.assertProfile('collector', 'getPositions');

    throw new NotImplementedError('getPositions not implemented', {
      profile: this.opts.profile,
      accountId: input.accountId,
    });
  }

  async placeOrder(input: PlaceOrderInput): Promise<OrderAckModel> {
    this.assertProfile('executor', 'placeOrder');

    throw new NotImplementedError('placeOrder not implemented', {
      profile: this.opts.profile,
      clientOrderId: input.clientOrderId,
    });
  }

  async cancelOrder(input: CancelOrderInput): Promise<OrderAckModel> {
    this.assertProfile('executor', 'cancelOrder');

    throw new NotImplementedError('cancelOrder not implemented', {
      profile: this.opts.profile,
      vendorOrderId: input.vendorOrderId,
    });
  }

  async modifyOrder(input: ModifyOrderInput): Promise<OrderAckModel> {
    this.assertProfile('executor', 'modifyOrder');

    throw new NotImplementedError('modifyOrder not implemented', {
      profile: this.opts.profile,
      vendorOrderId: input.vendorOrderId,
    });
  }

  async connectMarketDataStream(handler: MarketDataFrameHandler): Promise<void> {
    // Both profiles open a WS pipe: collector ingests 0B/0D market data,
    // executor ingests 00 execution frames. The REG message shape differs
    // and is controlled by subscribeMarketData (collector-only), so the
    // raw connection itself is profile-neutral.
    this.frameHandler = handler;

    this.userInitiatedDisconnect = false;

    this.opts.wsClient.onMessage((parsed) => this.routeFrame(parsed));

    this.opts.wsClient.onClose((code, reason) => {
      this.loggedIn = false;

      if (this.userInitiatedDisconnect) return;

      if (this.opts.reconnect?.enabled) {
        this.logger.warn(
          `ws closed unexpectedly code=${code} reason="${reason}" — scheduling reconnect`,
        );

        void this.scheduleReconnect();
      }
    });

    await this.opts.wsClient.connect();

    await this.performLogin();
  }

  async disconnectMarketDataStream(): Promise<void> {
    this.userInitiatedDisconnect = true;

    this.subscriptions.clear();

    this.loggedIn = false;

    this.frameHandler = null;

    await this.opts.wsClient.disconnect();
  }

  isMarketDataStreamConnected(): boolean {
    return this.opts.wsClient.isConnected() && this.loggedIn;
  }

  async subscribeMarketData(input: SubscribeMarketDataInput): Promise<MarketDataSubscription> {
    this.assertProfile('collector', 'subscribeMarketData');

    if (input.symbols.length === 0 || input.kinds.length === 0) {
      throw new DomainError(
        'subscribeMarketData requires at least one symbol and one kind',
        'KIWOOM_WS_SUBSCRIBE_EMPTY',
        { symbols: input.symbols.length, kinds: input.kinds.length },
      );
    }

    if (!this.opts.wsClient.isConnected() || !this.loggedIn) {
      throw new DomainError('subscribeMarketData called before LOGIN ack', 'KIWOOM_WS_NOT_READY', {
        profile: this.opts.profile,
        loggedIn: this.loggedIn,
      });
    }

    const additions: Record<string, string[]> = {};

    for (const kind of input.kinds) {
      const realtimeType = KIND_TO_REALTIME_TYPE[kind];

      additions[realtimeType] = additions[realtimeType] ?? [];

      for (const symbol of input.symbols) {
        const kinds = this.subscriptions.get(symbol) ?? new Set();

        if (!kinds.has(kind)) {
          additions[realtimeType].push(symbol);

          kinds.add(kind);

          this.subscriptions.set(symbol, kinds);
        }
      }
    }

    for (const [realtimeType, symbols] of Object.entries(additions)) {
      if (symbols.length === 0) continue;

      await this.opts.wsClient.send({
        trnm: 'REG',
        grp_no: '1',
        refresh: '1',
        data: [{ item: symbols, type: [realtimeType] }],
      });

      this.logger.log(`REG type=${realtimeType} symbols=${symbols.length}`);
    }

    return {
      subscribedSymbols: Array.from(this.subscriptions.keys()),
      unsubscribe: (unsubInput) =>
        this.unsubscribeMarketData(unsubInput ?? { symbols: input.symbols, kinds: input.kinds }),
    };
  }

  async unsubscribeMarketData(input: UnsubscribeMarketDataInput): Promise<void> {
    this.assertProfile('collector', 'unsubscribeMarketData');

    if (!this.opts.wsClient.isConnected()) return;

    const kinds = input.kinds ?? (['trade-tick', 'orderbook'] as MarketDataFrameKind[]);
    const removals: Record<string, string[]> = {};

    for (const kind of kinds) {
      const realtimeType = KIND_TO_REALTIME_TYPE[kind];

      removals[realtimeType] = removals[realtimeType] ?? [];

      for (const symbol of input.symbols) {
        const symbolKinds = this.subscriptions.get(symbol);

        if (!symbolKinds || !symbolKinds.has(kind)) continue;

        removals[realtimeType].push(symbol);

        symbolKinds.delete(kind);

        if (symbolKinds.size === 0) this.subscriptions.delete(symbol);
      }
    }

    for (const [realtimeType, symbols] of Object.entries(removals)) {
      if (symbols.length === 0) continue;

      await this.opts.wsClient.send({
        trnm: 'REMOVE',
        grp_no: '1',
        data: [{ item: symbols, type: [realtimeType] }],
      });

      this.logger.log(`REMOVE type=${realtimeType} symbols=${symbols.length}`);
    }
  }

  private routeFrame(parsed: unknown): void {
    const trnm = isPlainObject(parsed) ? parsed.trnm : null;

    if (trnm === 'LOGIN' || trnm === 'PING' || trnm === 'REG' || trnm === 'REMOVE') return;

    this.frameHandler?.(parsed);
  }

  private installLoginAckGate(): Promise<void> {
    const timeoutMs = this.opts.loginAckTimeoutMs ?? DEFAULT_LOGIN_ACK_TIMEOUT_MS;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();

        reject(new IntegrationError('Kiwoom LOGIN ack timeout', { timeoutMs }));
      }, timeoutMs);

      const unsubscribe = this.opts.wsClient.onMessage((parsed) => {
        if (!isPlainObject(parsed)) return;

        if (parsed.trnm !== 'LOGIN') return;

        clearTimeout(timer);

        unsubscribe();

        const returnCode = (parsed as { return_code?: unknown }).return_code;

        if (returnCode === 0 || returnCode === '0') {
          this.loggedIn = true;

          this.logger.log('LOGIN ack ok');

          resolve();
        } else {
          const msg = (parsed as { return_msg?: unknown }).return_msg;

          reject(
            new IntegrationError(`Kiwoom LOGIN failed return_code=${String(returnCode)}`, {
              returnCode,
              returnMsg: typeof msg === 'string' ? msg : null,
            }),
          );
        }
      });
    });
  }

  private async performLogin(): Promise<void> {
    const ack = this.installLoginAckGate();
    const token = await this.opts.tokenService.getAccessToken();

    await this.opts.wsClient.send({ trnm: 'LOGIN', token });

    await ack;

    const delay = this.opts.postLoginDelayMs ?? DEFAULT_POST_LOGIN_DELAY_MS;

    if (delay > 0) await sleep(delay);
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnecting) return;

    this.reconnecting = true;

    const initial = this.opts.reconnect?.initialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY_MS;
    const maxDelay = this.opts.reconnect?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    const maxAttempts = this.opts.reconnect?.maxAttempts ?? DEFAULT_RECONNECT_MAX_ATTEMPTS;

    try {
      while (!this.userInitiatedDisconnect) {
        this.reconnectAttempts += 1;

        if (maxAttempts > 0 && this.reconnectAttempts > maxAttempts) {
          this.logger.error(`reconnect gave up after ${maxAttempts} attempts`);

          return;
        }

        const delay = Math.min(initial * 2 ** (this.reconnectAttempts - 1), maxDelay);

        this.logger.log(`reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

        await sleep(delay);

        if (this.userInitiatedDisconnect) return;

        try {
          await this.opts.wsClient.connect();

          await this.performLogin();

          await this.replaySubscriptions();

          this.reconnectAttempts = 0;

          this.logger.log('reconnect ok');

          return;
        } catch (err) {
          this.logger.warn(
            `reconnect attempt ${this.reconnectAttempts} failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    } finally {
      this.reconnecting = false;
    }
  }

  private async replaySubscriptions(): Promise<void> {
    const byType: Record<string, string[]> = {};

    for (const [symbol, kinds] of this.subscriptions) {
      for (const kind of kinds) {
        const realtimeType = KIND_TO_REALTIME_TYPE[kind];

        byType[realtimeType] = byType[realtimeType] ?? [];

        byType[realtimeType].push(symbol);
      }
    }

    for (const [realtimeType, symbols] of Object.entries(byType)) {
      if (symbols.length === 0) continue;

      await this.opts.wsClient.send({
        trnm: 'REG',
        grp_no: '1',
        refresh: '1',
        data: [{ item: symbols, type: [realtimeType] }],
      });

      this.logger.log(`REG (replay) type=${realtimeType} symbols=${symbols.length}`);
    }
  }

  private assertProfile(expected: BrokerageGatewayProfile, method: string): void {
    if (this.opts.profile !== expected) {
      throw new NotImplementedError(
        `${method} called on ${this.opts.profile} gateway (expected ${expected})`,
        { profile: this.opts.profile, method },
      );
    }
  }
}

const KIND_TO_REALTIME_TYPE: Record<MarketDataFrameKind, string> = {
  'trade-tick': '0B',
  orderbook: '0D',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
