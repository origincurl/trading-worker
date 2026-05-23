import { Injectable, Optional } from '@nestjs/common';
import { redactPotentialSecrets } from '@common/util/redact.util';
import type { BrokerageVendorProfile } from '../brokerage.token';
import { RateLimiter } from '../service/rate-limiter.service';
import { SharedCredentialRateLimiter } from '../service/shared-credential-rate-limiter.service';
import { WorkerPolicyCache } from '@shared/policy/worker-policy.cache';

export type CredentialUsageKind = 'collector' | 'executor';
export type CredentialUsageOrigin =
  | 'COLLECTOR_MARKET'
  | 'EXECUTOR_STRATEGY'
  | 'TRACKER_STATUS'
  | 'TRACKER_ACCOUNT'
  | 'BE_MANUAL';
export type CredentialUsagePriority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
export type CredentialUsageActionType =
  | 'MARKET_DATA'
  | 'ORDER'
  | 'CANCEL'
  | 'MODIFY'
  | 'STATUS'
  | 'ACCOUNT_SYNC'
  | 'WS'
  | 'TOKEN'
  | 'UNKNOWN';

export interface CredentialUsageContext {
  readonly kind: CredentialUsageKind;
  readonly credentialId: number;
  readonly accountId?: number;
  readonly origin?: CredentialUsageOrigin;
  readonly priority?: CredentialUsagePriority;
  readonly actionType?: CredentialUsageActionType;
  readonly endpointType?: string;
}

export interface CredentialUsageHistoryEntry {
  readonly at: string;
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
}

export interface CredentialUsageSnapshot {
  readonly key: string;
  readonly kind: CredentialUsageKind;
  readonly origin: CredentialUsageOrigin;
  readonly priority: CredentialUsagePriority;
  readonly actionType: CredentialUsageActionType;
  readonly endpointType: string;
  readonly credentialId: number;
  readonly accountId: number | null;
  readonly profile: BrokerageVendorProfile;
  readonly endpoint: string;
  readonly requests: number;
  readonly successes: number;
  readonly failures: number;
  readonly rateLimited: number;
  readonly granted: number;
  readonly delayed: number;
  readonly rejected: number;
  readonly coalesced: number;
  readonly sharedLimiter: 'disabled' | 'enabled';
  readonly limiterConfig?: RateLimitConfig;
  readonly inFlight: number;
  readonly wsConnections: number;
  readonly wsSymbols: number;
  readonly lastUsedAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly lastError: string | null;
  readonly wsSymbolList: readonly string[];
  readonly history: readonly CredentialUsageHistoryEntry[];
}

interface MutableStats {
  kind: CredentialUsageKind;
  origin: CredentialUsageOrigin;
  priority: CredentialUsagePriority;
  actionType: CredentialUsageActionType;
  endpointType: string;
  credentialId: number;
  accountId: number | null;
  profile: BrokerageVendorProfile;
  endpoint: string;
  requests: number;
  successes: number;
  failures: number;
  rateLimited: number;
  granted: number;
  delayed: number;
  rejected: number;
  coalesced: number;
  sharedLimiter: 'disabled' | 'enabled';
  limiterConfig?: RateLimitConfig;
  inFlight: number;
  wsConnections: number;
  wsSymbols: number;
  lastUsedAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  wsSymbolList: string[];
  history: CredentialUsageHistoryEntry[];
}

interface RateLimitConfig {
  readonly capacity: number;
  readonly refillPerSecond: number;
  readonly maxConcurrent: number;
}

type PolicyValue = {
  readonly default?: Partial<RateLimitConfig>;
  readonly credentials?: Record<string, Partial<RateLimitConfig>>;
  readonly endpoints?: Record<string, Partial<RateLimitConfig>>;
};

const POLICY_KEY_BY_KIND: Record<CredentialUsageKind, string> = {
  collector: 'collector_credential_rate_limits',
  executor: 'executor_credential_rate_limits',
};

const DEFAULT_LIMITS: Record<CredentialUsageKind, RateLimitConfig> = {
  collector: { capacity: 10, refillPerSecond: 10, maxConcurrent: 4 },
  executor: { capacity: 5, refillPerSecond: 5, maxConcurrent: 2 },
};

const MAX_HISTORY_ENTRIES = 10;

@Injectable()
export class CredentialUsageService {
  private readonly stats = new Map<string, MutableStats>();

  private readonly limiters = new Map<string, RateLimiter>();

  private readonly limiterFingerprints = new Map<string, string>();

  constructor(
    @Optional() private readonly policyCache?: WorkerPolicyCache,
    @Optional() private readonly sharedLimiter?: SharedCredentialRateLimiter,
  ) {}

  async runRest<T>(
    profile: BrokerageVendorProfile,
    credential: CredentialUsageContext,
    endpoint: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const stats = this.getStats(profile, credential, endpoint);
    const limiter = this.getLimiter(profile, credential, endpoint);
    const config = this.resolveLimitConfig(credential, endpoint);
    let sharedLease: Awaited<ReturnType<SharedCredentialRateLimiter['acquire']>> = null;

    stats.limiterConfig = config;
    stats.requests += 1;
    stats.lastUsedAt = new Date();
    this.pushHistory(stats, 'info', `REST ${endpoint} request queued`);

    try {
      sharedLease = await this.sharedLimiter?.acquire({
        credentialId: credential.credentialId,
        endpointType: credential.endpointType ?? endpoint,
        origin: credential.origin ?? defaultOrigin(credential.kind),
        priority: credential.priority ?? defaultPriority(credential.kind),
        actionType: credential.actionType ?? defaultActionType(credential.kind, endpoint),
        capacity: config.capacity,
        refillPerSecond: config.refillPerSecond,
        maxConcurrent: config.maxConcurrent,
      }) ?? null;
      await limiter.acquire();
    } catch (err) {
      await sharedLease?.release();
      stats.rateLimited += 1;
      stats.rejected += 1;
      stats.failures += 1;
      stats.lastFailureAt = new Date();
      stats.lastError = redactPotentialSecrets(err instanceof Error ? err.message : String(err));
      this.pushHistory(stats, 'warn', `REST ${endpoint} rate-limited: ${stats.lastError}`);
      throw err;
    }

    stats.granted += 1;
    stats.inFlight += 1;

    try {
      const result = await fn();

      stats.successes += 1;
      stats.lastSuccessAt = new Date();
      stats.lastError = null;
      this.pushHistory(stats, 'info', `REST ${endpoint} success`);

      return result;
    } catch (err) {
      stats.failures += 1;
      if (isBrokerRateLimitError(err)) {
        stats.rateLimited += 1;
        stats.rejected += 1;
      }
      stats.lastFailureAt = new Date();
      stats.lastError = redactPotentialSecrets(err instanceof Error ? err.message : String(err));
      this.pushHistory(
        stats,
        isBrokerRateLimitError(err) ? 'warn' : 'error',
        `REST ${endpoint} failed: ${stats.lastError}`,
      );
      throw err;
    } finally {
      stats.inFlight = Math.max(0, stats.inFlight - 1);
      limiter.release();
      await sharedLease?.release();
    }
  }

  markWsConnected(
    profile: BrokerageVendorProfile,
    credential: CredentialUsageContext,
    symbols: number,
    symbolList: readonly string[] = [],
  ): void {
    const stats = this.getStats(profile, credential, 'WS');

    stats.wsConnections = 1;
    stats.wsSymbols = symbols;
    stats.wsSymbolList = normalizeSymbolList(symbolList);
    stats.lastUsedAt = new Date();
    stats.lastSuccessAt = new Date();
    this.pushHistory(stats, 'info', `WS connected; symbols=${symbols}`);
  }

  markWsDisconnected(
    profile: BrokerageVendorProfile,
    credential: CredentialUsageContext,
    reason?: string,
  ): void {
    const stats = this.getStats(profile, credential, 'WS');
    const safeReason = reason ? redactPotentialSecrets(reason) : null;

    stats.wsConnections = 0;
    stats.wsSymbols = 0;
    stats.wsSymbolList = [];
    stats.lastUsedAt = new Date();
    stats.lastError = safeReason ?? stats.lastError;
    this.pushHistory(stats, 'warn', safeReason ? `WS disconnected: ${safeReason}` : 'WS disconnected');
  }

  markWsSymbols(
    profile: BrokerageVendorProfile,
    credential: CredentialUsageContext,
    symbols: number,
    symbolList: readonly string[] = [],
  ): void {
    const stats = this.getStats(profile, credential, 'WS');

    stats.wsSymbols = symbols;
    stats.wsSymbolList = normalizeSymbolList(symbolList);
    stats.lastUsedAt = new Date();
    this.pushHistory(stats, 'info', `WS symbols changed; symbols=${symbols}`);
  }

  snapshot(): CredentialUsageSnapshot[] {
    const sharedLimiterState: CredentialUsageSnapshot['sharedLimiter'] =
      this.sharedLimiter?.isEnabled() ? 'enabled' : 'disabled';

    return Array.from(this.stats.entries())
      .map(([key, value]) => ({
        key,
        kind: value.kind,
        origin: value.origin,
        priority: value.priority,
        actionType: value.actionType,
        endpointType: value.endpointType,
        credentialId: value.credentialId,
        accountId: value.accountId,
        profile: value.profile,
        endpoint: value.endpoint,
        requests: value.requests,
        successes: value.successes,
        failures: value.failures,
        rateLimited: value.rateLimited,
        granted: value.granted,
        delayed: value.delayed,
        rejected: value.rejected,
        coalesced: value.coalesced,
        sharedLimiter: sharedLimiterState,
        limiterConfig: value.limiterConfig,
        inFlight: value.inFlight,
        wsConnections: value.wsConnections,
        wsSymbols: value.wsSymbols,
        lastUsedAt: value.lastUsedAt?.toISOString() ?? null,
        lastSuccessAt: value.lastSuccessAt?.toISOString() ?? null,
        lastFailureAt: value.lastFailureAt?.toISOString() ?? null,
        lastError: value.lastError,
        wsSymbolList: [...value.wsSymbolList],
        history: [...value.history],
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  private getStats(
    profile: BrokerageVendorProfile,
    credential: CredentialUsageContext,
    endpoint: string,
  ): MutableStats {
    const key = this.key(profile, credential, endpoint);
    const existing = this.stats.get(key);

    if (existing) return existing;

    const created: MutableStats = {
      kind: credential.kind,
      origin: credential.origin ?? defaultOrigin(credential.kind),
      priority: credential.priority ?? defaultPriority(credential.kind),
      actionType: credential.actionType ?? defaultActionType(credential.kind, endpoint),
      endpointType: credential.endpointType ?? endpoint,
      credentialId: credential.credentialId,
      accountId: credential.accountId ?? null,
      profile,
      endpoint,
      requests: 0,
      successes: 0,
      failures: 0,
      rateLimited: 0,
      granted: 0,
      delayed: 0,
      rejected: 0,
      coalesced: 0,
      sharedLimiter: this.sharedLimiter?.isEnabled() ? 'enabled' : 'disabled',
      limiterConfig: undefined,
      inFlight: 0,
      wsConnections: 0,
      wsSymbols: 0,
      lastUsedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      wsSymbolList: [],
      history: [],
    };

    this.stats.set(key, created);

    return created;
  }

  private getLimiter(
    profile: BrokerageVendorProfile,
    credential: CredentialUsageContext,
    endpoint: string,
  ): RateLimiter {
    const key = this.limiterKey(profile, credential, endpoint);
    const config = this.resolveLimitConfig(credential, endpoint);
    const fingerprint = JSON.stringify(config);
    const existing = this.limiters.get(key);

    if (existing && this.limiterFingerprints.get(key) === fingerprint) return existing;
    if (existing) {
      existing.reconfigure({
        name: key,
        capacity: config.capacity,
        refillPerSecond: config.refillPerSecond,
        maxConcurrent: config.maxConcurrent,
        waitOnExhaustion: false,
      });
      this.limiterFingerprints.set(key, fingerprint);

      return existing;
    }

    const created = new RateLimiter({
      name: key,
      capacity: config.capacity,
      refillPerSecond: config.refillPerSecond,
      maxConcurrent: config.maxConcurrent,
      waitOnExhaustion: false,
    });

    this.limiters.set(key, created);
    this.limiterFingerprints.set(key, fingerprint);

    return created;
  }

  private resolveLimitConfig(
    credential: CredentialUsageContext,
    endpoint: string,
  ): RateLimitConfig {
    const base = DEFAULT_LIMITS[credential.kind];
    const policy = this.policyCache?.get<PolicyValue>(POLICY_KEY_BY_KIND[credential.kind], {});
    const byCredential = policy?.credentials?.[String(credential.credentialId)] ?? {};
    const byEndpoint = policy?.endpoints?.[endpoint] ?? {};

    return normalizeLimitConfig(
      {
        ...base,
        ...(policy?.default ?? {}),
        ...byEndpoint,
        ...byCredential,
      },
      base,
    );
  }

  private key(
    profile: BrokerageVendorProfile,
    credential: CredentialUsageContext,
    endpoint: string,
  ): string {
    const origin = credential.origin ?? defaultOrigin(credential.kind);
    const actionType = credential.actionType ?? defaultActionType(credential.kind, endpoint);
    const endpointType = credential.endpointType ?? endpoint;

    return `${profile}:${origin}:${credential.credentialId}:${credential.accountId ?? 'none'}:${endpointType}:${actionType}`;
  }

  private limiterKey(
    profile: BrokerageVendorProfile,
    credential: CredentialUsageContext,
    endpoint: string,
  ): string {
    const endpointType = credential.endpointType ?? endpoint;

    return `${profile}:${credential.kind}:${credential.credentialId}:${credential.accountId ?? 'none'}:${endpointType}`;
  }

  private pushHistory(stats: MutableStats, level: CredentialUsageHistoryEntry['level'], message: string): void {
    stats.history.push({
      at: new Date().toISOString(),
      level,
      message,
    });

    if (stats.history.length > MAX_HISTORY_ENTRIES) {
      stats.history.splice(0, stats.history.length - MAX_HISTORY_ENTRIES);
    }
  }
}

function normalizeSymbolList(symbols: readonly string[]): string[] {
  return Array.from(new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))).sort();
}

function normalizeLimitConfig(
  input: Partial<RateLimitConfig>,
  fallback: RateLimitConfig,
): RateLimitConfig {
  return {
    capacity: positiveInt(input.capacity, fallback.capacity),
    refillPerSecond: positiveNumber(input.refillPerSecond, fallback.refillPerSecond),
    maxConcurrent: positiveInt(input.maxConcurrent, fallback.maxConcurrent),
  };
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultOrigin(kind: CredentialUsageKind): CredentialUsageOrigin {
  return kind === 'collector' ? 'COLLECTOR_MARKET' : 'EXECUTOR_STRATEGY';
}

function defaultPriority(kind: CredentialUsageKind): CredentialUsagePriority {
  return kind === 'collector' ? 'P2' : 'P1';
}

function defaultActionType(
  kind: CredentialUsageKind,
  endpoint: string,
): CredentialUsageActionType {
  if (endpoint === 'WS') return 'WS';
  if (kind === 'collector') return 'MARKET_DATA';
  if (endpoint === 'REST_ORDER') return 'ORDER';
  if (endpoint === 'REST_ACCOUNT') return 'STATUS';

  return 'UNKNOWN';
}

function isBrokerRateLimitError(err: unknown): boolean {
  const record = err && typeof err === 'object' ? (err as Record<string, unknown>) : {};
  const details =
    record.details && typeof record.details === 'object'
      ? (record.details as Record<string, unknown>)
      : {};
  const message = err instanceof Error ? err.message : String(err ?? '');
  const haystack = [
    record.code,
    details.status,
    details.returnCode,
    details.returnMsg,
    message,
  ]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ');

  return (
    haystack.includes('rate_limit') ||
    haystack.includes('rate') ||
    haystack.includes('limit') ||
    haystack.includes('429') ||
    haystack.includes('초과') ||
    haystack.includes('과다')
  );
}
