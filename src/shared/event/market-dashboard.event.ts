export type DashboardMarketCode = 'KOSPI' | 'KOSDAQ';
export type DashboardMarketEnv = 'MOCK' | 'PRODUCTION';

export interface DashboardMarketFlowPayload {
  readonly provider: 'KIWOOM';
  readonly marketEnv: DashboardMarketEnv;
  readonly market: string;
  readonly marketCode: DashboardMarketCode;
  readonly foreignNetBuy: number;
  readonly foreignBuy: number;
  readonly foreignSell: number;
  readonly institutionNetBuy: number;
  readonly institutionBuy: number;
  readonly institutionSell: number;
  readonly individualNetBuy: number;
  readonly individualBuy: number;
  readonly individualSell: number;
  readonly source: 'ka10051' | 'ka10063' | 'ka10066';
  readonly unit: 'KRW_MILLION' | 'SHARES';
  readonly updatedAt: string;
}

export interface DashboardMarketBreadthPayload {
  readonly provider: 'KIWOOM';
  readonly marketEnv: DashboardMarketEnv;
  readonly market: string;
  readonly marketCode: DashboardMarketCode;
  readonly risingCount: number;
  readonly upperLimitCount: number;
  readonly flatCount: number;
  readonly fallingCount: number;
  readonly lowerLimitCount: number;
  readonly tradedCount: number;
  readonly tradedRatio: number;
  readonly advanceDeclineRatio: number;
  readonly source: '0U';
  readonly updatedAt: string;
}

export interface DashboardMarketMoverPayload {
  readonly provider: 'KIWOOM';
  readonly marketEnv: DashboardMarketEnv;
  readonly code: string;
  readonly name: string;
  readonly currentPrice: number;
  readonly change: number;
  readonly changeRate: number;
  readonly volume: number;
  readonly tradingValue: number;
  readonly source: 'ka10019' | 'ka10027' | 'ka10028' | 'ka10029' | 'ka10030' | 'ka10032';
  readonly reason: string;
  readonly updatedAt: string;
}

export interface DashboardMarketOverviewPayload {
  readonly provider: 'KIWOOM';
  readonly marketEnv: DashboardMarketEnv;
  readonly refreshIntervalSec: number;
  readonly flows: DashboardMarketFlowPayload[];
  readonly breadth: DashboardMarketBreadthPayload[];
  readonly topTradingValue: DashboardMarketMoverPayload[];
  readonly topVolume: DashboardMarketMoverPayload[];
  readonly gainers: DashboardMarketMoverPayload[];
  readonly losers: DashboardMarketMoverPayload[];
  readonly updatedAt: string;
}

export const DASHBOARD_MARKET_CODES: readonly DashboardMarketCode[] = ['KOSPI', 'KOSDAQ'];

export const DASHBOARD_MARKET_NAMES: Readonly<Record<DashboardMarketCode, string>> = {
  KOSPI: 'KOSPI',
  KOSDAQ: 'KOSDAQ',
};

export const DASHBOARD_MARKET_KIWOOM_CODES: Readonly<Record<DashboardMarketCode, string>> = {
  KOSPI: '001',
  KOSDAQ: '101',
};

export function marketDashboardOverviewKey(provider: string, marketEnv: string): string {
  return `market:v1:dashboard:overview:${provider}:${marketEnv}`;
}

export function marketDashboardBreadthKey(provider: string, marketEnv: string, marketCode: string): string {
  return `market:v1:dashboard:breadth:${provider}:${marketEnv}:${marketCode}`;
}
