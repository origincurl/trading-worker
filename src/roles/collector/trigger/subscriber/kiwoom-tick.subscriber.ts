import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { COLLECTOR_CONFIG, type CollectorConfig } from '@config/collector.config';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { shouldHandle } from '@common/util/shard';
import { COLLECTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type {
  BrokerageVendor,
  MarketDataFrameKind,
} from '@external/brokerage/vendor/brokerage.vendor';
import { IngestTickUsecase } from '@roles/collector/usecase/ingest-tick.usecase';
import { RefreshUniverseUsecase } from '@roles/collector/usecase/refresh-universe.usecase';
import { MARKET_INDEX_CODES } from '@shared/event/market-index.event';
import { resolveMarketRealtimeProfile } from '@roles/collector/market-realtime-profile';

// Connects to Kiwoom WS (LOGIN included), then:
//   1. REGs the optional bootstrap symbol set (dev convenience)
//   2. Primes the BE universe lease so production-approved symbols REG
//      without waiting on the next scheduler tick
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
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
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
    const bootstrap = this.applyShardFilter(this.config.bootstrapSymbols);

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

      if (bootstrap.length > 0) {
        await this.gateway.subscribeMarketData({ symbols: bootstrap, kinds });

        this._subscribedSymbols = bootstrap;

        this.logger.log(
          `bootstrap subscribed: symbols=${bootstrap.length} kinds=[${kinds.join(',')}]`,
        );
      } else {
        this.logger.log('no bootstrap symbols — waiting on universe lease');
      }

      if (this.config.subscribeMarketIndex) {
        const indexCodes = Object.values(MARKET_INDEX_CODES);

        await this.gateway.subscribeMarketData({ symbols: indexCodes, kinds: ['market-index'] });

        this.logger.log(
          `market index subscribed: symbols=${indexCodes.join(',')} kinds=[market-index]`,
        );
      }

      // Phase 6.7: prime universe lease once after WS is up so BE-approved
      // symbols become subscribed without waiting for the scheduler tick.
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

  private applyShardFilter(symbols: readonly string[]): string[] {
    return symbols.filter((s) => shouldHandle(s, this.runtime.shardIndex, this.runtime.shardCount));
  }
}
