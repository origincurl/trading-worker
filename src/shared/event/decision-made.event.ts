import type { MarketTickProvider } from './market-tick.event';

// `decision.made` is delivered via Redis Streams. notifier dedups on
// (sourceType, sourceId, eventType). Producer fills only external IDs —
// notifier resolves internal PKs (architecture.md §7, phase/08 §3).
export const DECISION_MADE_EVENT_TYPE = 'decision.made';
export const DECISION_MADE_SCHEMA_VERSION = 1;
export const DECISION_MADE_STREAM = 'decision.made';

export type DecisionType = 'BUY' | 'SELL' | 'HOLD' | string;

export interface DecisionMadePayload {
  readonly accountExternalId: string;
  readonly brokerage: MarketTickProvider;
  readonly marketEnv: 'mock' | 'production';
  // The strategy event code this decision was made from (free-form per
  // strategy). notifier maps this to EventEntity.event_type.
  readonly sourceStrategyEventCode: string;
  readonly decisionType: DecisionType;
  readonly symbol: string | null;
  readonly score: string | null;
  readonly quantity: string | null;
  readonly price: string | null;
  readonly amount: string | null;
  readonly reason: string | null;
  readonly decidedAt: string;
}
