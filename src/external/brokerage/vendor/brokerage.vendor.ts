import type { AccountBalanceModel, PositionModel } from '../model/account.model';
import type { OrderAckModel, OrderSide, OrderType } from '../model/order.model';
import type {
  CandleChartMarket,
  MarketCandleClosedPayload,
} from '@shared/event/market-candle-closed.event';
import type { MarketIndexPayload, MarketIndexSymbol } from '@shared/event/market-index.event';
import type {
  DashboardMarketFlowPayload,
  DashboardMarketMoverPayload,
} from '@shared/event/market-dashboard.event';

export interface GetAccountBalanceInput {
  readonly accountId: string;
}

export interface GetPositionsInput {
  readonly accountId: string;
}

export interface PlaceOrderInput {
  readonly accountId: string;
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly quantity: number;
  readonly price?: number;
}

export interface CancelOrderInput {
  readonly accountId: string;
  readonly vendorOrderId: string;
}

export interface ModifyOrderInput {
  readonly accountId: string;
  readonly vendorOrderId: string;
  readonly symbol?: string;
  readonly quantity?: number;
  readonly price?: number;
}

// Phase 6: real-time market data subscription. Collector-only — the
// executor profile gateway throws on these methods (rate budgets must stay
// separate; collector ws bandwidth cannot bleed into order ack latency).
export type MarketDataFrameKind = 'trade-tick' | 'orderbook' | 'market-index' | 'market-breadth';

export interface SubscribeMarketDataInput {
  readonly symbols: readonly string[];
  readonly kinds: readonly MarketDataFrameKind[];
}

export interface UnsubscribeMarketDataInput {
  readonly symbols: readonly string[];
  readonly kinds?: readonly MarketDataFrameKind[];
}

export type MarketDataFrameHandler = (rawFrame: unknown) => void;

export interface MarketDataSubscription {
  readonly subscribedSymbols: readonly string[];
  unsubscribe(input?: UnsubscribeMarketDataInput): Promise<void>;
}

// Phase E: chart catchup. Collector calls this to backfill closed candles
// for a (symbol, intervalType) range. Kiwoom chart APIs are anchor based:
// baseDt is sent to the broker, while acceptFrom/acceptTo decide which rows
// are persisted from the returned cap-sized batch.
export interface FetchChartCandlesInput {
  readonly requestId?: string;
  readonly symbol: string;
  readonly marketEnv: 'mock' | 'production';
  readonly chartMarket?: CandleChartMarket;
  readonly intervalType: '1m' | '1d';
  readonly fromIso: string;
  readonly toIso: string;
  readonly baseDt?: string;
  readonly acceptFromIso?: string;
  readonly acceptToIso?: string;
}

// Phase E: stock master list. One entry per listed symbol on a given
// exchange. marketCode is the worker-facing KOSPI / KOSDAQ / KONEX label;
// the kiwoom vendor maps from its native venue tag.
export interface StockMasterEntry {
  readonly symbol: string;
  readonly name: string;
  readonly marketCode: 'KOSPI' | 'KOSDAQ' | 'KONEX';
  readonly currency?: string;
  readonly isinSymbol?: string;
}

export interface GetStockMasterListInput {
  readonly marketEnv: 'mock' | 'production';
}

export interface FetchMarketIndexSnapshotsInput {
  readonly marketEnv: 'mock' | 'production';
  readonly symbols: readonly MarketIndexSymbol[];
}

export type MarketIndexSnapshot = MarketIndexPayload;

export interface FetchDashboardMarketFlowsInput {
  readonly marketEnv: 'mock' | 'production';
}

export interface FetchDashboardMarketMoversInput {
  readonly marketEnv: 'mock' | 'production';
  readonly limit?: number;
}

export interface BrokerageVendor {
  // collector-facing read paths
  getAccountBalance(input: GetAccountBalanceInput): Promise<AccountBalanceModel>;
  getAccountBalanceForAccount(
    accountId: number,
    input: GetAccountBalanceInput,
  ): Promise<AccountBalanceModel>;
  getPositions(input: GetPositionsInput): Promise<PositionModel[]>;
  getPositionsForAccount(accountId: number, input: GetPositionsInput): Promise<PositionModel[]>;
  // Phase E: chart catchup. Collector-only. Returns MarketCandleClosedPayload[]
  // ordered ascending by candleTime, filtered to the [fromIso, toIso) range.
  fetchChartCandles(input: FetchChartCandlesInput): Promise<MarketCandleClosedPayload[]>;
  // Phase E: stock master list. Collector-only — feeds the stock_list sync.
  getStockMasterList(input: GetStockMasterListInput): Promise<StockMasterEntry[]>;
  // Header market index snapshots. Collector-only — feeds BE's Redis-only
  // `/v1/market-data/indices` reader.
  fetchMarketIndexSnapshots(
    input: FetchMarketIndexSnapshotsInput,
  ): Promise<MarketIndexSnapshot[]>;
  fetchDashboardMarketFlows(
    input: FetchDashboardMarketFlowsInput,
  ): Promise<DashboardMarketFlowPayload[]>;
  fetchDashboardMarketMovers(input: FetchDashboardMarketMoversInput): Promise<{
    topTradingValue: DashboardMarketMoverPayload[];
    topVolume: DashboardMarketMoverPayload[];
    gainers: DashboardMarketMoverPayload[];
    losers: DashboardMarketMoverPayload[];
  }>;

  // executor-facing write paths
  placeOrder(input: PlaceOrderInput): Promise<OrderAckModel>;
  // Phase C: executor profile resolves the account-scoped credential
  // before placing the order. `accountId` is the internal accounts.id PK
  // — the gateway looks up the matching account_credential row through
  // CredentialSourceService. accountExternalId stays on the payload
  // because vendor APIs take the external string.
  placeOrderForAccount(accountId: number, input: PlaceOrderInput): Promise<OrderAckModel>;
  // Uses the api credential stamped on the order row at creation time.
  // This avoids auth/body drift if account credential assignment changes
  // between BE order creation and executor pickup.
  placeOrderForAccountCredential(
    accountId: number,
    apiCredentialId: number,
    accountExternalId: string,
    input: PlaceOrderInput,
  ): Promise<OrderAckModel>;
  cancelOrder(input: CancelOrderInput): Promise<OrderAckModel>;
  // Phase J pair to placeOrderForAccount: cancellation pickup resolves
  // credentials through CredentialSourceService against the order's
  // accountId, then issues the vendor cancel keyed by externalOrderId.
  // `accountExternalId` is required for the vendor wire body (acntNo)
  // because vendor APIs take the external string, not the internal PK.
  cancelOrderForAccount(
    accountId: number,
    accountExternalId: string,
    externalOrderId: string,
    symbol?: string,
    quantity?: number,
  ): Promise<OrderAckModel>;
  cancelOrderForAccountCredential(
    accountId: number,
    apiCredentialId: number,
    accountExternalId: string,
    externalOrderId: string,
    symbol?: string,
    quantity?: number,
  ): Promise<OrderAckModel>;
  modifyOrder(input: ModifyOrderInput): Promise<OrderAckModel>;
  modifyOrderForAccount(accountId: number, input: ModifyOrderInput): Promise<OrderAckModel>;

  // collector-facing real-time stream paths
  connectMarketDataStream(handler: MarketDataFrameHandler): Promise<void>;
  disconnectMarketDataStream(): Promise<void>;
  isMarketDataStreamConnected(): boolean;
  subscribeMarketData(input: SubscribeMarketDataInput): Promise<MarketDataSubscription>;
  unsubscribeMarketData(input: UnsubscribeMarketDataInput): Promise<void>;
}
