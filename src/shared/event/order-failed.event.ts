import type { MarketTickProvider } from './market-tick.event';

// `order.failed` is delivered via Redis Streams. Produced by executor when
// the vendor rejects or the call throws. Payload carries external IDs only
// (architecture.md §7, phase/08 §3).
export const ORDER_FAILED_EVENT_TYPE = 'order.failed';
export const ORDER_FAILED_SCHEMA_VERSION = 1;
export const ORDER_FAILED_STREAM = 'order.failed';

export interface OrderFailedPayload {
  readonly accountExternalId: string;
  readonly brokerage: MarketTickProvider;
  readonly marketEnv: 'mock' | 'production';
  readonly clientOrderId: string | null;
  readonly symbol: string;
  readonly reason: string;
  readonly errorCode: string | null;
  readonly failedAt: string;
}
