export type MarketIndexSymbol = 'KOSPI' | 'KOSDAQ';

export const MARKET_INDEX_EVENT_TYPE = 'market.index';
export const MARKET_INDEX_SCHEMA_VERSION = 1;

export interface MarketIndexPayload {
  readonly provider: 'KIWOOM';
  readonly marketEnv: 'MOCK' | 'PRODUCTION';
  readonly symbol: MarketIndexSymbol;
  readonly name: string;
  readonly lastUpdatedAt: string;
  readonly value: number | null;
  readonly change: number | null;
  readonly changePct: number | null;
  readonly volume: number | null;
  readonly tradeValue: number | null;
}

export const MARKET_INDEX_CODES: Readonly<Record<MarketIndexSymbol, string>> = {
  KOSPI: '001',
  KOSDAQ: '101',
};

export const MARKET_INDEX_SYMBOL_BY_CODE: Readonly<Record<string, MarketIndexSymbol>> = {
  '001': 'KOSPI',
  '101': 'KOSDAQ',
};

export const MARKET_INDEX_NAMES: Readonly<Record<MarketIndexSymbol, string>> = {
  KOSPI: 'KOSPI',
  KOSDAQ: 'KOSDAQ',
};

export function marketIndexChannel(
  provider: MarketIndexPayload['provider'],
  marketEnv: MarketIndexPayload['marketEnv'],
  symbol: MarketIndexSymbol,
): string {
  return `market.index.${provider}.${marketEnv}.${symbol}`;
}
