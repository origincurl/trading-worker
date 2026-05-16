import type { MarketTickProvider } from './market-tick.event';

// `indicator.updated` is live fan-out (pubsub). DB stores authoritative
// rows so consumers that miss a publish replay from `indicator_1m`.
export const INDICATOR_UPDATED_EVENT_TYPE = 'indicator.updated';
export const INDICATOR_UPDATED_SCHEMA_VERSION = 1;

export type IndicatorType = 'sma' | 'ema';

export interface IndicatorUpdatedPayload {
  readonly provider: MarketTickProvider;
  readonly marketEnv: 'mock' | 'production';
  readonly symbol: string;
  readonly intervalType: '1m';
  readonly bucketStart: string;
  readonly indicatorType: IndicatorType;
  readonly windowSize: number;
  // null when the rolling window is not yet warm. Consumers must guard
  // on this; nulls are still published so dashboards can show "warming up".
  readonly value: number | null;
  readonly computedAt: string;
}

export function indicatorChannel(
  provider: MarketTickProvider,
  marketEnv: 'mock' | 'production',
  symbol: string,
  indicatorType: IndicatorType,
  windowSize: number,
): string {
  return `indicator.${indicatorType}${windowSize}.${provider}.${marketEnv}.${symbol}`;
}
