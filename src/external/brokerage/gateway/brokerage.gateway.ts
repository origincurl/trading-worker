import type { AccountBalanceModel, PositionModel } from '../model/account.model';
import type { OrderAckModel, OrderSide, OrderType } from '../model/order.model';

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
  readonly quantity?: number;
  readonly price?: number;
}

// Phase 6: real-time market data subscription. Collector-only — the
// executor profile gateway throws on these methods (rate budgets must stay
// separate; collector ws bandwidth cannot bleed into order ack latency).
export type MarketDataFrameKind = 'trade-tick' | 'orderbook';

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

export interface BrokerageGateway {
  // collector-facing read paths
  getAccountBalance(input: GetAccountBalanceInput): Promise<AccountBalanceModel>;
  getPositions(input: GetPositionsInput): Promise<PositionModel[]>;

  // executor-facing write paths
  placeOrder(input: PlaceOrderInput): Promise<OrderAckModel>;
  cancelOrder(input: CancelOrderInput): Promise<OrderAckModel>;
  modifyOrder(input: ModifyOrderInput): Promise<OrderAckModel>;

  // collector-facing real-time stream paths
  connectMarketDataStream(handler: MarketDataFrameHandler): Promise<void>;
  disconnectMarketDataStream(): Promise<void>;
  isMarketDataStreamConnected(): boolean;
  subscribeMarketData(input: SubscribeMarketDataInput): Promise<MarketDataSubscription>;
  unsubscribeMarketData(input: UnsubscribeMarketDataInput): Promise<void>;
}
