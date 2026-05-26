// Low-latency BE -> executor command for manual/order-intent rows.
// The durable source of truth is still the `orders` table; this pubsub
// command is a wake-up signal. DB polling remains the fallback path.

export const ORDER_COMMAND_CHANNEL = 'order.command';
export const ORDER_COMMAND_EVENT_TYPE = 'order.command';
export const ORDER_COMMAND_SCHEMA_VERSION = 1;

export type OrderCommandSource = 'manual' | 'strategy' | 'risk_liquidation';
export type OrderCommandPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface OrderCommandPayload {
  readonly orderId: number;
  readonly accountId: number;
  readonly source: OrderCommandSource;
  readonly priority: OrderCommandPriority;
}
