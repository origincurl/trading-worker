export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';
export type OrderStatus = 'accepted' | 'rejected' | 'partial' | 'filled' | 'cancelled';

export interface OrderAckModel {
  readonly vendorOrderId: string;
  readonly clientOrderId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly quantity: number;
  readonly price?: number;
  readonly status: OrderStatus;
  readonly acceptedAt: string;
}
