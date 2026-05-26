import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { WORKER_POLICY_REPOSITORY } from '@shared/persistence/worker-policy/worker-policy.token';
import type { WorkerPolicyRepository } from '@shared/persistence/worker-policy/worker-policy.repository';
import { WorkerRole } from '@shared/model/worker-policy/worker-role.enum';

const SCHEDULER_NAME = 'shared.worker-policy.refresh';
const DEFAULT_REFRESH_INTERVAL_SEC = 60;

function toWireWorkerRole(role: string): WorkerRole | null {
  switch (role.toLowerCase()) {
    case 'collector':
      return WorkerRole.Collector;
    case 'tracker':
      return WorkerRole.Tracker;
    case 'calculator':
      return WorkerRole.Calculator;
    case 'executor':
      return WorkerRole.Executor;
    case 'detector':
      return WorkerRole.Detector;
    case 'notifier':
      return WorkerRole.Notifier;
    default:
      return null;
  }
}

// In-memory snapshot of worker_policies rows for all roles active in this
// process. Phase B: source is the worker's own DB (via
// WorkerPolicyRepository) — BE control-plane is no longer involved.
// Lookups are role-agnostic: callers ask for a key and receive the value
// seen across any of the worker's active roles (collisions are unlikely;
// policies are role-scoped). On collision the last role processed wins.
@Injectable()
export class WorkerPolicyCache implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkerPolicyCache.name);

  // key -> raw valueJson string (caller parses with key-appropriate schema).
  private readonly entries = new Map<string, string>();

  private readonly refreshIntervalMs: number;

  private readonly wireRoles: readonly WorkerRole[];

  private bootstrapped = false;

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    @Inject(WORKER_POLICY_REPOSITORY) private readonly repo: WorkerPolicyRepository,
    private readonly registry: SchedulerRegistry,
  ) {
    const raw = process.env.WORKER_POLICY_REFRESH_INTERVAL_SEC;
    const parsed = raw ? Number(raw) : NaN;
    const sec = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REFRESH_INTERVAL_SEC;

    this.refreshIntervalMs = sec * 1000;
    this.wireRoles = this.runtime.roles
      .map((r) => toWireWorkerRole(r))
      .filter((r): r is WorkerRole => r !== null);
  }

  async onApplicationBootstrap(): Promise<void> {
    // Initial fetch is awaited so role schedulers can consume policies
    // from the very first tick without a race window. DB outage at boot
    // must not block the worker — schedulers fall back to their compiled
    // defaults until the next refresh succeeds.
    try {
      await this.refresh();
    } catch (err) {
      this.logger.warn(
        `initial worker-policy fetch failed; using defaults until next refresh: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    this.bootstrapped = true;

    if (this.registry.doesExist('interval', SCHEDULER_NAME)) {
      return;
    }

    const handle = setInterval(() => {
      this.refresh().catch((err) =>
        this.logger.warn(
          `worker-policy refresh failed: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }, this.refreshIntervalMs);

    this.registry.addInterval(SCHEDULER_NAME, handle);

    this.logger.log(
      `worker-policy cache refreshing every ${this.refreshIntervalMs / 1000}s for roles=[${this.wireRoles.join(',')}]`,
    );
  }

  onModuleDestroy(): void {
    if (this.registry.doesExist('interval', SCHEDULER_NAME)) {
      this.registry.deleteInterval(SCHEDULER_NAME);
    }
  }

  // Returns the parsed value for `key` or the supplied default. `defaultValue`
  // is also the schema hint — the cache JSON.parse()s the raw valueJson and
  // returns it as T. Callers that need a string should pass a string default.
  get<T>(key: string, defaultValue: T): T {
    const raw = this.entries.get(key);

    if (raw === undefined) return defaultValue;

    try {
      const parsed = JSON.parse(raw) as unknown;

      if (
        parsed &&
        typeof parsed === 'object' &&
        'value' in parsed &&
        typeof defaultValue !== 'object'
      ) {
        return (parsed as { value: T }).value;
      }

      return parsed as T;
    } catch (err) {
      this.logger.warn(
        `policy key=${key} valueJson is not valid JSON, falling back to default: ${
          err instanceof Error ? err.message : err
        }`,
      );

      return defaultValue;
    }
  }

  size(): number {
    return this.entries.size;
  }

  isBootstrapped(): boolean {
    return this.bootstrapped;
  }

  private async refresh(): Promise<void> {
    if (this.wireRoles.length === 0) return;

    const next = new Map<string, string>();

    for (const role of this.wireRoles) {
      const policies = await this.repo.findByRole(role);

      for (const p of policies) {
        if (!p.isActive) continue;

        if (next.has(p.key)) {
          this.logger.warn(
            `policy key collision on '${p.key}' across roles; later role=${role} wins`,
          );
        }

        // DB JSON columns deserialize to objects; stringify for storage so
        // `get<T>` can JSON.parse uniformly. Worker schedulers store scalar
        // intervals as `{"value": 300}` or raw scalars; we accept either.
        const raw = typeof p.valueJson === 'string' ? p.valueJson : JSON.stringify(p.valueJson);

        next.set(p.key, raw);
      }
    }

    this.entries.clear();

    for (const [k, v] of next) this.entries.set(k, v);
  }
}
