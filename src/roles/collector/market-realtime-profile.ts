import { KiwoomMarketEnv } from '@config/kiwoom.config';
import type { MarketDataFrameKind } from '@external/brokerage/vendor/brokerage.vendor';
import type { CandleChartMarket } from '@shared/event/market-candle-closed.event';

export type ChartLiveSource = 'trade_tick_0B' | 'broker_chart_AL';

export interface MarketRealtimeProfile {
  readonly marketEnv: KiwoomMarketEnv;
  readonly chartLiveSource: ChartLiveSource;
  readonly chartMarket: CandleChartMarket;
  readonly chartLiveSourceSupported: boolean;
  readonly fallbackChartLiveSource: ChartLiveSource | null;
  readonly bootstrapKinds: readonly MarketDataFrameKind[];
}

const MOCK_PROFILE: MarketRealtimeProfile = {
  marketEnv: KiwoomMarketEnv.Mock,
  chartLiveSource: 'trade_tick_0B',
  chartMarket: 'KRW',
  chartLiveSourceSupported: true,
  fallbackChartLiveSource: null,
  bootstrapKinds: ['trade-tick'],
};

const PRODUCTION_PROFILE: MarketRealtimeProfile = {
  marketEnv: KiwoomMarketEnv.Production,
  chartLiveSource: 'broker_chart_AL',
  // TODO(broker-chart-AL): switch this to AL when the AL parser becomes the
  // supported live chart source. Until then production uses KRW 0B fallback.
  chartMarket: 'KRW',
  chartLiveSourceSupported: false,
  fallbackChartLiveSource: 'trade_tick_0B',
  bootstrapKinds: ['trade-tick'],
};

export function resolveMarketRealtimeProfile(marketEnv: KiwoomMarketEnv): MarketRealtimeProfile {
  return marketEnv === KiwoomMarketEnv.Production ? PRODUCTION_PROFILE : MOCK_PROFILE;
}
