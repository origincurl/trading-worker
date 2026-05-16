import type { WorkerRole } from '@config/runtime.config';
import type { KiwoomMarketEnv } from '@config/kiwoom.config';

export interface WorkerEventProducer {
  readonly role: WorkerRole;
  readonly instanceId: string;
}

export interface WorkerEvent<T = unknown> {
  readonly eventId: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly occurredAt: string;
  readonly producer: WorkerEventProducer;
  readonly marketEnv: KiwoomMarketEnv;
  readonly payload: T;
}

export type EventTypeOf<E extends WorkerEvent> = E['eventType'];
