export interface EventRecordInput {
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly accountId: string | null;
  readonly accountStrategyEventId: string | null;
  readonly accountRiskEventId: string | null;
  readonly eventType: string;
  readonly level: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: Date;
}

export interface RecordedEvent {
  readonly id: string;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly eventType: string;
  readonly level: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: Date;
}

export interface EventRepository {
  // Returns the existing row when the unique key already exists so
  // ingesters can short-circuit downstream work idempotently.
  insertIfAbsent(input: EventRecordInput): Promise<{ event: RecordedEvent; isNew: boolean }>;

  markProcessed(eventId: string, processedAt: Date): Promise<void>;
}

export const EVENT_REPOSITORY = Symbol('EVENT_REPOSITORY');
