import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { COLLECTOR_CONFIG, type CollectorConfig } from '@config/collector.config';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { COLLECTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type {
  BrokerageVendor,
  MarketDataFrameKind,
} from '@external/brokerage/vendor/brokerage.vendor';
import { IngestTickUsecase } from '@roles/collector/usecase/ingest-tick.usecase';
import { RefreshUniverseUsecase } from '@roles/collector/usecase/refresh-universe.usecase';
import { MARKET_INDEX_CODES } from '@shared/event/market-index.event';
import { resolveMarketRealtimeProfile } from '@roles/collector/market-realtime-profile';

// Connects to Kiwoom WS (LOGIN included), then primes the demand-driven
// universe so FE/strategy-requested symbols REG without waiting for the next
// scheduler tick. Individual symbol bootstrap is intentionally gone; only
// market index defaults remain policy-driven.
// WS failure does not crash the worker — status drops to degraded and
// Phase 6.8 will layer reconnect on top.
@Injectable()
export class KiwoomTickSubscriber implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(KiwoomTickSubscriber.name);

  private _connected = false;

  private _subscribedSymbols: readonly string[] = [];

  constructor(
    @Inject(COLLECTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Inject(COLLECTOR_CONFIG) private readonly config: CollectorConfig,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    private readonly usecase: IngestTickUsecase,
    private readonly refreshUniverse: RefreshUniverseUsecase,
  ) {}

  isConnected(): boolean {
    return this._connected;
  }

  subscribedSymbols(): readonly string[] {
    return this._subscribedSymbols;
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.gateway.connectMarketDataStream((frame) => {
        // Sync handler — schedule async work and swallow errors here so a
        // bad frame does not tear down the WS pipe.
        this.usecase
          .execute(frame)
          .catch((err) =>
            this.logger.warn(`ingest failed: ${err instanceof Error ? err.message : err}`),
          );
      });

      this._connected = true;

      const profile = resolveMarketRealtimeProfile(this.kiwoom.marketEnv);
      const kinds: MarketDataFrameKind[] = [...profile.bootstrapKinds];

      if (this.config.subscribeOrderbook) kinds.push('orderbook');

      if (!profile.chartLiveSourceSupported) {
        this.logger.warn(
          `chart live source ${profile.chartLiveSource} is not implemented yet; using fallback ${profile.fallbackChartLiveSource ?? 'none'} kinds=[${kinds.join(',')}]`,
        );
      }

      this.logger.log(`waiting on demand-driven universe lease kinds=[${kinds.join(',')}]`);

      if (this.config.subscribeMarketIndex) {
        const indexCodes = Object.values(MARKET_INDEX_CODES);

        await this.gateway.subscribeMarketData({ symbols: indexCodes, kinds: ['market-index'] });

        this.logger.log(
          `market index subscribed: symbols=${indexCodes.join(',')} kinds=[market-index]`,
        );
      }

      // Prime universe lease once after WS is up so active FE/strategy demand
      // becomes subscribed without waiting for the scheduler tick.
      await this.refreshUniverse
        .execute()
        .catch((err) =>
          this.logger.warn(
            `initial universe refresh failed: ${err instanceof Error ? err.message : err}`,
          ),
        );
    } catch (err) {
      this._connected = false;

      this.logger.warn(
        `WS connect/subscribe failed — collector boots degraded: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this._connected) return;

    try {
      await this.gateway.disconnectMarketDataStream();
    } catch (err) {
      this.logger.warn(`WS disconnect failed: ${err instanceof Error ? err.message : err}`);
    }

    this._connected = false;

    this._subscribedSymbols = [];
  }
}
