import { Inject, Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { BUS_STREAMS } from '@shared/bus/bus.token';
import type { BusStreams } from '@shared/bus/bus-streams.interface';
import {
  ALERT_RAISED_EVENT_TYPE,
  ALERT_RAISED_SCHEMA_VERSION,
  ALERT_RAISED_STREAM,
  type AlertCategory,
  type AlertSeverity,
} from '@shared/event/alert-raised.event';
import { WorkerEventFactory } from '@shared/event/event-factory';

@Injectable()
export class ChartArchiveAlertService {
  private readonly logger = new Logger(ChartArchiveAlertService.name);

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    @Inject(BUS_STREAMS) private readonly streams: BusStreams,
    private readonly eventFactory: WorkerEventFactory,
  ) {}

  async raise(input: {
    category: AlertCategory;
    severity: AlertSeverity;
    subject: string;
    message: string;
    metadata?: Record<string, string>;
  }): Promise<void> {
    const payload = {
      alertId: ulid(),
      category: input.category,
      severity: input.severity,
      subject: input.subject,
      message: input.message,
      metadata: input.metadata,
      raisedAt: new Date().toISOString(),
      workerInstanceId: this.runtime.workerInstanceId,
    };
    const event = this.eventFactory.build({
      eventType: ALERT_RAISED_EVENT_TYPE,
      schemaVersion: ALERT_RAISED_SCHEMA_VERSION,
      role: 'collector',
      payload,
    });
    await this.streams.produce(ALERT_RAISED_STREAM, event).catch((err) => {
      this.logger.warn(`chart archive alert publish failed: ${err instanceof Error ? err.message : err}`);
    });
  }
}
