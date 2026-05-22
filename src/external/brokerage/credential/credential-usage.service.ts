import { Injectable, Optional } from '@nestjs/common';
import { redactPotentialSecrets } from '@common/util/redact.util';
import type { BrokerageVendorProfile } from '../brokerage.token';
import { RateLimiter } from '../service/rate-limiter.service';
import { WorkerPolicyCache } from '@shared/policy/worker-policy.cache';

export type CredentialUsageKind = 'collector' | 'executor';

export interface CredentialUsageContext {
  readonly kind: CredentialUsageKind;
  readonly credentialId: number;
  readonly accountId?: number;
}

export interface CredentialUsageHistoryEntry {
  readonly at: string;
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
}

export interface CredentialUsageSnapshot {
  readonly key: string;
  readonly kind: CredentialUsageKind;
  readonly credentialId: number;
  readonly accountId: number | null;
  readonly profile: BrokerageVendorProfile;
  readonly endpoint: string;
  readonly requests: number;
  readonly successes: number;
  readonly failures: number;
  readonly rateLimited: number;
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
  credentialId: number;
  accountId: number | null;
  profile: BrokerageVendorProfile;
  endpoint: string;
  requests: number;
  successes: number;
  failures: number;
  rateLimited: number;
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

  constructor(@Optional() private readonly policyCache?: WorkerPolicyCache) {}

  async runRest<T>(
    profile: BrokerageVendorProfile,
    credential: CredentialUsageContext,
    endpoint: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const stats = this.getStats(profile, credential, endpoint);
    const limiter = this.getLimiter(profile, credential, endpoint);

    stats.requests += 1;
    stats.lastUsedAt = new Date();
    this.pushHistory(stats, 'info', `REST ${endpoint} request queued`);

    try {
      await limiter.acquire();
    } catch (err) {
      stats.rateLimited += 1;
      stats.failures += 1;
      stats.lastFailureAt = new Date();
      stats.lastError = redactPotentialSecrets(err instanceof Error ? err.message : String(err));
      this.pushHistory(stats, 'warn', `REST ${endpoint} rate-limited: ${stats.lastError}`);
      throw err;
    }

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
      stats.lastFailureAt = new Date();
      stats.lastError = redactPotentialSecrets(err instanceof Error ? err.message : String(err));
      this.pushHistory(stats, 'error', `REST ${endpoint} failed: ${stats.lastError}`);
      throw err;
    } finally {
      stats.inFlight = Math.max(0, stats.inFlight - 1);
      limiter.release();
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

  markWsDisconnected(profile: BrokerageVendorProfile, credential: CredentialUsageContext): void {
    const stats = this.getStats(profile, credential, 'WS');

    stats.wsConnections = 0;
    stats.wsSymbols = 0;
    stats.wsSymbolList = [];
    stats.lastUsedAt = new Date();
    this.pushHistory(stats, 'warn', 'WS disconnected');
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
    return Array.from(this.stats.entries())
      .map(([key, value]) => ({
        key,
        kind: value.kind,
        credentialId: value.credentialId,
        accountId: value.accountId,
        profile: value.profile,
        endpoint: value.endpoint,
        requests: value.requests,
        successes: value.successes,
        failures: value.failures,
        rateLimited: value.rateLimited,
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
      credentialId: credential.credentialId,
      accountId: credential.accountId ?? null,
      profile,
      endpoint,
      requests: 0,
      successes: 0,
      failures: 0,
      rateLimited: 0,
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
    const key = this.key(profile, credential, endpoint);
    const config = this.resolveLimitConfig(credential, endpoint);
    const fingerprint = JSON.stringify(config);
    const existing = this.limiters.get(key);

    if (existing && this.limiterFingerprints.get(key) === fingerprint) return existing;
    if (existing) {
      existing.reconfigure({
        name: `kiwoom.${profile}.${credential.kind}.${credential.credentialId}.${endpoint}`,
        capacity: config.capacity,
        refillPerSecond: config.refillPerSecond,
        maxConcurrent: config.maxConcurrent,
        waitOnExhaustion: false,
      });
      this.limiterFingerprints.set(key, fingerprint);

      return existing;
    }

    const created = new RateLimiter({
      name: `kiwoom.${profile}.${credential.kind}.${credential.credentialId}.${endpoint}`,
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
    return `${profile}:${credential.kind}:${credential.credentialId}:${credential.accountId ?? 'none'}:${endpoint}`;
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
