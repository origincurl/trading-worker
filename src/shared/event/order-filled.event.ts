import type { MarketTickProvider } from './market-tick.event';
import type { OrderIntentSide } from './signal-detected.event';

// `order.filled` is delivered via Redis Streams. BE consumer-group
// dedups on (provider, marketEnv, vendorOrderId).
export const ORDER_FILLED_EVENT_TYPE = 'order.filled';
export const ORDER_FILLED_SCHEMA_VERSION = 1;
export const ORDER_FILLED_STREAM = 'order.filled';

export interface OrderFilledPayload {
  readonly provider: MarketTickProvider;
  readonly marketEnv: 'mock' | 'production';
  readonly accountId: string;
  readonly clientOrderId: string;
  readonly vendorOrderId: string;
  readonly externalFillId?: string;
  readonly symbol: string;
  readonly side: OrderIntentSide;
  readonly filledQty: number;
  readonly filledPrice: number;
  readonly filledAt: string;
}
