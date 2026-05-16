import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import type { UniverseLeaseModel } from '@external/be-control-plane/model/universe-lease.model';

// Holds the BE-approved universe snapshot in memory and validates env
// isolation. Phase 6.7 enforces:
//   - snapshot.marketEnv MUST match worker's KIWOOM_MARKET_ENV
//   - snapshot.version is monotonic; older versions are rejected silently
//   - symbols are deduplicated and sorted (deterministic shard hashing)
@Injectable()
export class UniverseService {
  private readonly logger = new Logger(UniverseService.name);

  private current: UniverseLeaseModel | null = null;

  constructor(@Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig) {}

  currentSnapshot(): UniverseLeaseModel | null {
    return this.current;
  }

  // Returns true if the snapshot was applied (newer than current).
  apply(snapshot: UniverseLeaseModel): boolean {
    if (snapshot.marketEnv !== this.kiwoom.marketEnv) {
      throw new DomainError(
        `universe snapshot marketEnv mismatch: got ${snapshot.marketEnv}, worker is ${this.kiwoom.marketEnv}`,
        'UNIVERSE_MARKET_ENV_MISMATCH',
        { got: snapshot.marketEnv, expected: this.kiwoom.marketEnv },
      );
    }

    if (this.current && snapshot.version <= this.current.version) {
      this.logger.debug(
        `snapshot v${snapshot.version} older than current v${this.current.version}, ignoring`,
      );

      return false;
    }

    const normalized: UniverseLeaseModel = {
      ...snapshot,
      symbols: this.normalizeSymbols(snapshot.symbols),
    };

    this.current = normalized;

    this.logger.log(
      `universe snapshot applied: leaseId=${snapshot.leaseId} v=${snapshot.version} symbols=${normalized.symbols.length}`,
    );

    return true;
  }

  private normalizeSymbols(
    symbols: readonly UniverseLeaseModel['symbols'][number][],
  ): UniverseLeaseModel['symbols'] {
    const seen = new Map<string, UniverseLeaseModel['symbols'][number]>();

    for (const entry of symbols) {
      if (!entry.symbol) continue;

      if (!seen.has(entry.symbol)) seen.set(entry.symbol, entry);
    }

    return Array.from(seen.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
}
