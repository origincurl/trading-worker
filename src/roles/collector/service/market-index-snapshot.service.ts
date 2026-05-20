import { Inject, Injectable, Logger } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { COLLECTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import { MarketSnapshotWriter } from '@shared/cache/market-snapshot.writer';
import type { MarketIndexPayload, MarketIndexSymbol } from '@shared/event/market-index.event';

const INDEX_SYMBOLS: readonly MarketIndexSymbol[] = ['KOSPI', 'KOSDAQ'];

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
    const snapshots = await this.gateway.fetchMarketIndexSnapshots({
      marketEnv,
      symbols: INDEX_SYMBOLS,
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
}
