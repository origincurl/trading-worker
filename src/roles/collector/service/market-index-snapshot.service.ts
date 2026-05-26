import { Inject, Injectable, Logger } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { COLLECTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import { MarketSnapshotWriter } from '@shared/cache/market-snapshot.writer';
import type { MarketIndexPayload, MarketIndexSymbol } from '@shared/event/market-index.event';

const INDEX_SYMBOLS: readonly MarketIndexSymbol[] = ['KOSPI', 'KOSDAQ'];
const WS_FALLBACK_STALE_MS = 90_000;

@Injectable()
export class MarketIndexSnapshotService {
  private readonly logger = new Logger(MarketIndexSnapshotService.name);

  constructor(
    @Inject(COLLECTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    private readonly writer: MarketSnapshotWriter,
  ) {}

  async refresh(): Promise<void> {
    const marketEnv = this.kiwoom.marketEnv === 'production' ? 'production' : 'mock';
    if (!isKrxContinuousSession(new Date())) {
      this.logger.debug('market index REST fallback skipped outside KRX continuous session');

      return;
    }

    const staleSymbols = await this.symbolsNeedingRestFallback(marketEnv);

    if (staleSymbols.length === 0) {
      this.logger.debug('market index REST fallback skipped; ws_0J snapshots are fresh');

      return;
    }

    const snapshots = await this.gateway.fetchMarketIndexSnapshots({
      marketEnv,
      symbols: staleSymbols,
    });
    const cachedAt = new Date().toISOString();

    for (const snapshot of snapshots) {
      await this.writer.writeIndex({
        payload: snapshot,
        cachedAt,
        source: 'rest_ka20001',
      });
    }

    this.logger.debug(`market index snapshots refreshed count=${snapshots.length}`);
  }

  async recordRealtime(snapshot: MarketIndexPayload): Promise<void> {
    await this.writer
      .writeIndex({
        payload: snapshot,
        cachedAt: new Date().toISOString(),
        source: 'ws_0J',
      })
      .catch((err) =>
        this.logger.warn(
          `market index realtime write failed (${snapshot.symbol}): ${
            err instanceof Error ? err.message : err
          }`,
        ),
      );
  }

  private async symbolsNeedingRestFallback(marketEnv: 'mock' | 'production'): Promise<MarketIndexSymbol[]> {
    const now = Date.now();
    const entries = await Promise.all(
      INDEX_SYMBOLS.map(async (symbol) => ({
        symbol,
        entry: await this.writer.readIndex({
          provider: 'KIWOOM',
          marketEnv: marketEnv === 'production' ? 'PRODUCTION' : 'MOCK',
          symbol,
        }),
      })),
    );

    return entries
      .filter(({ entry }) => {
        if (!entry) return true;
        if (entry.source !== 'ws_0J') return true;

        const cachedAtMs = Date.parse(entry.cachedAt);
        if (!Number.isFinite(cachedAtMs)) return true;

        return now - cachedAtMs > WS_FALLBACK_STALE_MS;
      })
      .map(({ symbol }) => symbol);
  }
}

function isKrxContinuousSession(now: Date): boolean {
  const kst = new Date(now.getTime() + 9 * 60 * 60_000);
  const day = kst.getUTCDay();
  if (day === 0 || day === 6) return false;

  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();

  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}
