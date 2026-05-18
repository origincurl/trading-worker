import type { MarketTickProvider } from './market-tick.event';

// `order.placed` is delivered via Redis Streams. Produced by executor on
// successful vendor ack. Payload carries external IDs only — notifier
// resolves internal PKs (architecture.md §7, phase/08 §3).
export const ORDER_PLACED_EVENT_TYPE = 'order.placed';
export const ORDER_PLACED_SCHEMA_VERSION = 1;
export const ORDER_PLACED_STREAM = 'order.placed';

export type OrderPlacedType = 'BUY' | 'SELL';
export type OrderPlacedMethod = 'LIMIT' | 'MARKET';

export interface OrderPlacedPayload {
  readonly accountExternalId: string;
  readonly brokerage: MarketTickProvider;
  readonly marketEnv: 'mock' | 'production';
  readonly externalOrderId: string;
  readonly clientOrderId: string | null;
  readonly symbol: string;
  readonly orderType: OrderPlacedType;
  readonly orderMethod: OrderPlacedMethod;
  readonly quantity: string;
  readonly price: string | null;
  readonly placedAt: string;
}
