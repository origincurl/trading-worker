import { KiwoomMarketEnv } from '@config/kiwoom.config';
import type { MarketDataFrameKind } from '@external/brokerage/vendor/brokerage.vendor';

export type ChartLiveSource = 'trade_tick_0B' | 'broker_chart_AL';

export interface MarketRealtimeProfile {
  readonly marketEnv: KiwoomMarketEnv;
  readonly chartLiveSource: ChartLiveSource;
  readonly chartLiveSourceSupported: boolean;
  readonly fallbackChartLiveSource: ChartLiveSource | null;
  readonly bootstrapKinds: readonly MarketDataFrameKind[];
}

const MOCK_PROFILE: MarketRealtimeProfile = {
  marketEnv: KiwoomMarketEnv.Mock,
  chartLiveSource: 'trade_tick_0B',
  chartLiveSourceSupported: true,
  fallbackChartLiveSource: null,
  bootstrapKinds: ['trade-tick'],
};

const PRODUCTION_PROFILE: MarketRealtimeProfile = {
  marketEnv: KiwoomMarketEnv.Production,
  chartLiveSource: 'broker_chart_AL',
  chartLiveSourceSupported: false,
  fallbackChartLiveSource: 'trade_tick_0B',
  bootstrapKinds: ['trade-tick'],
};

export function resolveMarketRealtimeProfile(marketEnv: KiwoomMarketEnv): MarketRealtimeProfile {
  return marketEnv === KiwoomMarketEnv.Production ? PRODUCTION_PROFILE : MOCK_PROFILE;
}
