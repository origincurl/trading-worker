import { Injectable, Logger } from '@nestjs/common';
import type { ObservedSymbolModel } from '@shared/model/universe/observed-symbol.model';

// Live universe = FE-observed symbols now; strategy demand joins the same
// demand-driven path later. Admin watchlists are intentionally not broker WS
// sources.
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

  private feCount = 0;

  private strategyCount = 0;

  private positionCount = 0;

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

  observedFeCount(): number {
    return this.feCount;
  }

  strategyDemandCount(): number {
    return this.strategyCount;
  }

  positionDemandCount(): number {
    return this.positionCount;
  }

  lastAppliedAtMs(): number | null {
    return this.lastAppliedAt?.getTime() ?? null;
  }

  // Builds the normalized global demand set without mutating current worker
  // ownership. RefreshUniverseUsecase uses this before shard assignment.
  normalizeDemand(
    chartSymbols: readonly ObservedSymbolModel[],
    strategySymbols: readonly ObservedSymbolModel[],
    positionSymbols: readonly ObservedSymbolModel[] = [],
  ): ObservedSymbolModel[] {
    return this.normalize([...chartSymbols, ...strategySymbols, ...positionSymbols]);
  }

  // Replaces the in-memory universe atomically with the worker-owned subset of
  // the current global demand snapshot. currentSymbols is never set to the
  // global cluster universe, so frame filtering cannot briefly see symbols
  // owned by another collector.
  applyAssignedSnapshot(
    chartSymbols: readonly ObservedSymbolModel[],
    strategySymbols: readonly ObservedSymbolModel[],
    positionSymbols: readonly ObservedSymbolModel[],
    assignedSymbols: readonly string[],
  ): number {
    const merged = this.normalizeDemand(chartSymbols, strategySymbols, positionSymbols);
    const assigned = new Set(assignedSymbols);
    const current = merged.filter((symbol) => assigned.has(symbol.symbol));

    this.feCount = this.normalize(chartSymbols).length;

    this.strategyCount = this.normalize(strategySymbols).length;

    this.positionCount = this.normalize(positionSymbols).length;

    this.desiredSymbols = merged;

    this.currentSymbols = current;

    this.lastAppliedAt = new Date();

    this.logger.log(`universe assigned: global=${merged.length} assigned=${current.length}`);

    return this.currentSymbols.length;
  }

  // Dedup by symbol. Sort deterministically so the downstream gateway SUB diff
  // is stable across refreshes.
  private normalize(entries: readonly ObservedSymbolModel[]): ObservedSymbolModel[] {
    const byKey = new Map<string, ObservedSymbolModel>();

    for (const entry of entries) {
      if (!entry.symbol) continue;

      const existing = byKey.get(entry.symbol);

      if (!existing) {
        byKey.set(entry.symbol, entry);

        continue;
      }

      byKey.set(entry.symbol, {
        symbol: entry.symbol,
        source: existing.source === entry.source ? existing.source : 'BOTH',
        instrumentType: existing.instrumentType === 'STOCK' ? 'STOCK' : entry.instrumentType,
      });
    }

    return Array.from(byKey.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
}
