import { KiwoomMarketEnv } from '@config/kiwoom.config';
import { resolveMarketRealtimeProfile } from './market-realtime-profile';

describe('resolveMarketRealtimeProfile', () => {
  it('uses 0B trade ticks as the mock chart live source', () => {
    expect(resolveMarketRealtimeProfile(KiwoomMarketEnv.Mock)).toMatchObject({
      marketEnv: KiwoomMarketEnv.Mock,
      chartLiveSource: 'trade_tick_0B',
      chartLiveSourceSupported: true,
      fallbackChartLiveSource: null,
      bootstrapKinds: ['trade-tick'],
    });
  });

  it('marks production AL chart as the target source but keeps a safe fallback until parser support lands', () => {
    expect(resolveMarketRealtimeProfile(KiwoomMarketEnv.Production)).toMatchObject({
      marketEnv: KiwoomMarketEnv.Production,
      chartLiveSource: 'broker_chart_AL',
      chartLiveSourceSupported: false,
      fallbackChartLiveSource: 'trade_tick_0B',
      bootstrapKinds: ['trade-tick'],
    });
  });
});
