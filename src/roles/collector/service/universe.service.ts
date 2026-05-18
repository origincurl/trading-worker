import { Inject, Injectable, Logger } from '@nestjs/common';
import { shouldHandle } from '@common/util/shard';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import type {
  ObservedSymbolModel,
  ObservedSymbolSource,
} from '@shared/model/universe/observed-symbol.model';

// Phase B universe = admin-curated stocks ∪ admin-curated ETFs ∪
// FE-observed stocks (redis HASH `fe:observation:stocks:refcnt`).
// UniverseService normalizes (dedup by symbol — same symbol can appear in
// both stock and ETF lists with different source flags), applies the
// shard hash filter, and exposes per-source counts for heartbeat metrics.
// Each refresh is the authoritative snapshot — no version/leaseId.
@Injectable()
export class UniverseService {
  private readonly logger = new Logger(UniverseService.name);

  private currentSymbols: ObservedSymbolModel[] = [];

  private adminCount = 0;

  private feCount = 0;

  private bothCount = 0;

  private lastAppliedAt: Date | null = null;

  constructor(@Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig) {}

  // Returns the shard-filtered, normalized observation universe.
  symbols(): readonly ObservedSymbolModel[] {
    return this.currentSymbols;
  }

  // Convenience for callers that only need raw symbol strings.
  symbolList(): readonly string[] {
    return this.currentSymbols.map((s) => s.symbol);
  }

  size(): number {
    return this.currentSymbols.length;
  }

  observedAdminCount(): number {
    return this.adminCount;
  }

  observedFeCount(): number {
    return this.feCount;
  }

  lastAppliedAtMs(): number | null {
    return this.lastAppliedAt?.getTime() ?? null;
  }

  // Replaces the in-memory universe with the union of admin stocks +
  // admin ETFs + FE-observed symbols. Returns the number of symbols that
  // actually landed in this worker's shard.
  apply(
    adminStocks: readonly ObservedSymbolModel[],
    adminEtfs: readonly ObservedSymbolModel[],
    feSymbols: readonly ObservedSymbolModel[],
  ): number {
    const merged = this.normalize([...adminStocks, ...adminEtfs, ...feSymbols]);

    const sharded = merged.filter((s) =>
      shouldHandle(s.symbol, this.runtime.shardIndex, this.runtime.shardCount),
    );

    this.currentSymbols = sharded;
    this.lastAppliedAt = new Date();
    this.adminCount = this.countSource(merged, 'ADMIN');
    this.feCount = this.countSource(merged, 'FE');
    this.bothCount = this.countSource(merged, 'BOTH');

    this.logger.log(
      `universe applied: total=${merged.length} sharded=${sharded.length} admin=${this.adminCount} fe=${this.feCount} both=${this.bothCount}`,
    );

    return sharded.length;
  }

  private countSource(
    list: readonly ObservedSymbolModel[],
    source: ObservedSymbolSource,
  ): number {
    return list.reduce((acc, s) => (s.source === source ? acc + 1 : acc), 0);
  }

  // Dedup by symbol. When the same symbol appears with different source
  // flags we promote to BOTH. Sort deterministically so the downstream
  // gateway SUB diff is stable across refreshes.
  private normalize(entries: readonly ObservedSymbolModel[]): ObservedSymbolModel[] {
    const byKey = new Map<string, ObservedSymbolModel>();

    for (const entry of entries) {
      if (!entry.symbol) continue;

      const existing = byKey.get(entry.symbol);

      if (!existing) {
        byKey.set(entry.symbol, entry);

        continue;
      }

      const promotedSource: ObservedSymbolSource =
        existing.source === entry.source ? existing.source : 'BOTH';

      byKey.set(entry.symbol, {
        symbol: entry.symbol,
        source: promotedSource,
        instrumentType: existing.instrumentType === 'STOCK' ? 'STOCK' : entry.instrumentType,
      });
    }

    return Array.from(byKey.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
}
