// Streams payload for non-fatal ingestion anomalies. Phase 6.9 routes
// dispatcher dead-letters, candle-builder rejections, and tick parse
// warnings into one stream so operators can replay/inspect after the fact.
//
// Stream name: `collector.dead-letter`. consumer-group dedup: (eventId).
// Worker schema retention: 7 days (handled in DB-side cron, not here).
export const COLLECTOR_DEAD_LETTER_EVENT_TYPE = 'collector.dead-letter';
export const COLLECTOR_DEAD_LETTER_SCHEMA_VERSION = 1;
export const COLLECTOR_DEAD_LETTER_STREAM = 'collector.dead-letter';

export type CollectorDeadLetterReason =
  | 'unrecognized-realtime-type'
  | 'missing-symbol'
  | 'parse-error'
  | 'parse-warning'
  | 'stale-tick'
  | 'invalid-price'
  | 'invalid-volume'
  | 'missing-required-field';

export interface CollectorDeadLetterPayload {
  readonly provider: 'kiwoom';
  readonly marketEnv: 'mock' | 'production';
  readonly workerInstanceId: string;
  readonly reason: CollectorDeadLetterReason;
  readonly realtimeType: string | null;
  readonly symbol: string | null;
  readonly receivedAt: string;
  readonly detail: string;
  readonly parseWarnings?: readonly string[];
}
