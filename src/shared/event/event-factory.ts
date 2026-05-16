import { Inject, Injectable } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { newEventId } from './event-id';
import type { WorkerEvent } from './worker-event';

export interface BuildEventInput<T> {
  eventType: string;
  schemaVersion: number;
  // Which active role is producing. Caller passes its own role explicitly
  // so events stay attributable when a process hosts multiple roles.
  role: WorkerEvent['producer']['role'];
  payload: T;
  occurredAt?: Date;
}

@Injectable()
export class WorkerEventFactory {
  constructor(
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
  ) {}

  build<T>(input: BuildEventInput<T>): WorkerEvent<T> {
    return {
      eventId: newEventId(),
      eventType: input.eventType,
      schemaVersion: input.schemaVersion,
      occurredAt: (input.occurredAt ?? new Date()).toISOString(),
      producer: {
        role: input.role,
        instanceId: this.runtime.workerInstanceId,
      },
      marketEnv: this.kiwoom.marketEnv,
      payload: input.payload,
    };
  }
}

export const WORKER_EVENT_FACTORY = Symbol('WORKER_EVENT_FACTORY');
