// `signal.detected` is a BullMQ job payload (queue name = SIGNAL_DETECTED_QUEUE).
// jobId = signalId so duplicate enqueues collapse to one job.
//
// Per architecture.md §3 + the "signal is not an order" rule: payload carries
// what's needed to PLACE an order, but quantity/price/account belong to BE
// policy. They land here pre-resolved by BE.
import type { MarketTickProvider } from './market-tick.event';

export const SIGNAL_DETECTED_QUEUE = 'signal.detected';

export type OrderIntentSide = 'buy' | 'sell';
export type OrderIntentType = 'market' | 'limit';

export interface SignalDetectedJobPayload {
  readonly signalId: string;
  readonly strategy: string;
  readonly provider: MarketTickProvider;
  readonly marketEnv: 'mock' | 'production';
  readonly internalAccountId?: number;
  readonly accountId: string;
  readonly symbol: string;
  readonly side: OrderIntentSide;
  readonly orderType: OrderIntentType;
  readonly quantity: number;
  readonly price?: number;
  readonly detectedAt: string;
  // Hint from BE so worker can correlate back. Worker generates its own
  // `clientOrderId` for the vendor — never reuses signalId.
  readonly clientOrderIdHint?: string;
}
