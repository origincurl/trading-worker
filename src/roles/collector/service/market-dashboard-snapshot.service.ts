import { Inject, Injectable, Logger } from '@nestjs/common';
import { COLLECTOR_CONFIG, type CollectorConfig } from '@config/collector.config';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { COLLECTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import { MarketSnapshotWriter } from '@shared/cache/market-snapshot.writer';
import {
  DASHBOARD_MARKET_CODES,
  type DashboardMarketBreadthPayload,
  type DashboardMarketOverviewPayload,
} from '@shared/event/market-dashboard.event';

@Injectable()
export class MarketDashboardSnapshotService {
  private readonly logger = new Logger(MarketDashboardSnapshotService.name);

  constructor(
    @Inject(COLLECTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Inject(COLLECTOR_CONFIG) private readonly config: CollectorConfig,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    private readonly writer: MarketSnapshotWriter,
  ) {}

  async refresh(): Promise<void> {
    const marketEnv = this.kiwoom.marketEnv === 'production' ? 'production' : 'mock';
    const marketEnvWire = marketEnv === 'production' ? 'PRODUCTION' : 'MOCK';
    const refreshIntervalSec = this.configuredRefreshIntervalSec();
    const previous = await this.writer.readDashboardOverview({
      provider: 'KIWOOM',
      marketEnv: marketEnvWire,
    });
    const [flows, movers, breadthEntries] = await Promise.all([
      this.gateway.fetchDashboardMarketFlows({ marketEnv }),
      this.gateway.fetchDashboardMarketMovers({ marketEnv, limit: 10 }),
      this.readBreadth(marketEnvWire),
    ]);
    const cachedAt = new Date().toISOString();
    const previousPayload = previous?.payload;
    const hasFreshFlows = flows.length > 0;
    const hasFreshBreadth = breadthEntries.length > 0;
    const hasFreshMovers =
      movers.topTradingValue.length > 0 ||
      movers.topVolume.length > 0 ||
      movers.gainers.length > 0 ||
      movers.losers.length > 0;

    if (!hasFreshFlows && !hasFreshBreadth && !hasFreshMovers) {
      this.logger.warn(
        `dashboard market overview refresh produced no fresh data; keeping previous cache freshness unchanged marketEnv=${marketEnvWire}`,
      );

      return;
    }

    const payload: DashboardMarketOverviewPayload = {
      provider: 'KIWOOM',
      marketEnv: marketEnvWire,
      refreshIntervalSec,
      flows: hasFreshFlows ? flows : previousPayload?.flows ?? [],
      breadth: hasFreshBreadth
        ? breadthEntries.map((entry) => entry.payload)
        : previousPayload?.breadth ?? [],
      topTradingValue: movers.topTradingValue.length > 0
        ? movers.topTradingValue
        : previousPayload?.topTradingValue ?? [],
      topVolume: movers.topVolume.length > 0 ? movers.topVolume : previousPayload?.topVolume ?? [],
      gainers: movers.gainers.length > 0 ? movers.gainers : previousPayload?.gainers ?? [],
      losers: movers.losers.length > 0 ? movers.losers : previousPayload?.losers ?? [],
      updatedAt: cachedAt,
    };

    await this.writer.writeDashboardOverview({
      payload,
      cachedAt,
      refreshIntervalSec,
      source: hasFreshBreadth ? 'mixed_rest_ws' : 'rest_ka10051_ka10019',
    });

    this.logger.debug(
      `dashboard market overview refreshed freshFlows=${flows.length} freshBreadth=${breadthEntries.length} freshValue=${movers.topTradingValue.length} freshVolume=${movers.topVolume.length} freshGainers=${movers.gainers.length} freshLosers=${movers.losers.length} totalCalls<=8`,
    );
  }

  async recordBreadth(payload: DashboardMarketBreadthPayload): Promise<void> {
    const cachedAt = new Date().toISOString();

    await this.writer
      .writeDashboardBreadth({
        payload,
        cachedAt,
        source: 'ws_0U',
      })
      .catch((err) =>
        this.logger.warn(
          `dashboard breadth realtime write failed (${payload.marketCode}): ${
            err instanceof Error ? err.message : err
          }`,
        ),
      );

    await this.mergeBreadthIntoOverview(payload, cachedAt).catch((err) =>
      this.logger.warn(
        `dashboard overview realtime breadth merge failed (${payload.marketCode}): ${
          err instanceof Error ? err.message : err
        }`,
      ),
    );
  }

  private async mergeBreadthIntoOverview(
    payload: DashboardMarketBreadthPayload,
    cachedAt: string,
  ): Promise<void> {
    const overview = await this.writer.readDashboardOverview({
      provider: payload.provider,
      marketEnv: payload.marketEnv,
    });

    if (!overview) return;

    const nextBreadth = [
      ...overview.payload.breadth.filter((entry) => entry.marketCode !== payload.marketCode),
      payload,
    ].sort((a, b) => a.market.localeCompare(b.market));

    await this.writer.writeDashboardOverview({
      payload: {
        ...overview.payload,
        breadth: nextBreadth,
        updatedAt: cachedAt,
      },
      cachedAt,
      refreshIntervalSec: overview.refreshIntervalSec ?? overview.payload.refreshIntervalSec,
      source: 'mixed_rest_ws',
    });
  }

  private async readBreadth(marketEnv: 'MOCK' | 'PRODUCTION') {
    const entries = await Promise.all(
      DASHBOARD_MARKET_CODES.map((marketCode) =>
        this.writer.readDashboardBreadth({ provider: 'KIWOOM', marketEnv, marketCode }),
      ),
    );

    return entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  private configuredRefreshIntervalSec(): number {
    return this.config.dashboardIntervalSec;
  }
}
