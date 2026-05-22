import { Injectable, Logger } from '@nestjs/common';
import type {
  ObservedSymbolModel,
  ObservedSymbolSource,
} from '@shared/model/universe/observed-symbol.model';

// Live universe = FE-observed symbols now; strategy demand joins the same
// demand-driven path later. Admin watchlists are intentionally not direct
// broker WS sources.
// UniverseService normalizes (dedup by symbol — same symbol can appear in
// both stock and ETF lists with different source flags) and exposes
// per-source counts for heartbeat metrics. Dynamic collector ownership is
// applied by CollectorShardAssignmentService.
// Each refresh is the authoritative snapshot — no version/leaseId.
@Injectable()
export class UniverseService {
  private readonly logger = new Logger(UniverseService.name);

  private desiredSymbols: ObservedSymbolModel[] = [];

  private currentSymbols: ObservedSymbolModel[] = [];

  private adminCount = 0;

  private feCount = 0;

  private bothCount = 0;

  private lastAppliedAt: Date | null = null;

  // Returns the worker-assigned, normalized observation universe.
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

  // Replaces the in-memory universe with the union of active demand sources.
  // Admin args are kept for compatibility with the source-counter model but
  // normal refresh passes them empty. Returns all normalized symbols before
  // collector ownership assignment.
  apply(
    adminStocks: readonly ObservedSymbolModel[],
    adminEtfs: readonly ObservedSymbolModel[],
    feSymbols: readonly ObservedSymbolModel[],
  ): ObservedSymbolModel[] {
    const merged = this.normalize([...adminStocks, ...adminEtfs, ...feSymbols]);

    this.adminCount = this.countSource(merged, 'ADMIN');

    this.feCount = this.countSource(merged, 'FE');

    this.bothCount = this.countSource(merged, 'BOTH');

    this.desiredSymbols = merged;

    return merged;
  }

  applyAssigned(symbols: readonly string[]): number {
    const assigned = new Set(symbols);

    this.currentSymbols = this.currentSymbolsFromAssigned(assigned);

    this.lastAppliedAt = new Date();

    this.logger.log(`universe assigned: assigned=${this.currentSymbols.length}`);

    return this.currentSymbols.length;
  }

  private countSource(list: readonly ObservedSymbolModel[], source: ObservedSymbolSource): number {
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

  private currentSymbolsFromAssigned(assigned: ReadonlySet<string>): ObservedSymbolModel[] {
    return this.desiredSymbols.filter((symbol) => assigned.has(symbol.symbol));
  }
}
