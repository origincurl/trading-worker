import { Inject, Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import type {
  NotifyVendor,
  NotifyInput,
  NotifySeverity,
} from '@external/notify/vendor/notify.vendor';
import { NOTIFY_GATEWAY } from '@external/notify/notify.token';
import { BUS_STREAMS } from '@shared/bus/bus.token';
import type { BusStreams } from '@shared/bus/bus-streams.interface';
import {
  ALERT_RAISED_EVENT_TYPE,
  ALERT_RAISED_SCHEMA_VERSION,
  ALERT_RAISED_STREAM,
  type AlertRaisedPayload,
} from '@shared/event/alert-raised.event';
import { WorkerEventFactory } from '@shared/event/event-factory';
import {
  ALERT_REPOSITORY,
  type AlertRepository,
} from '@roles/detector/repository/alert.repository';
import type { AlertCandidate } from './alert-evaluator.service';

// Default dedup window. The same (category, subjectKey) won't re-raise
// within this period. Phase 9.x will add ack/resolve hooks for escalation.
const DEDUP_WINDOW_MS = 5 * 60 * 1_000;

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  // (category, subjectKey) → last-raised epoch ms
  private readonly openWindow = new Map<string, number>();

  private _raised = 0;

  private _suppressedDedup = 0;

  private _lastRaisedAt: Date | null = null;

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    @Inject(NOTIFY_GATEWAY) private readonly notify: NotifyVendor,
    @Inject(BUS_STREAMS) private readonly streams: BusStreams,
    @Inject(ALERT_REPOSITORY) private readonly repo: AlertRepository,
    private readonly eventFactory: WorkerEventFactory,
  ) {}

  raisedCount(): number {
    return this._raised;
  }

  suppressedCount(): number {
    return this._suppressedDedup;
  }

  lastRaisedAt(): Date | null {
    return this._lastRaisedAt;
  }

  async raise(candidate: AlertCandidate): Promise<void> {
    const key = `${candidate.category}:${candidate.subjectKey}`;
    const now = Date.now();
    const lastAt = this.openWindow.get(key) ?? 0;

    if (now - lastAt < DEDUP_WINDOW_MS) {
      this._suppressedDedup += 1;

      return;
    }

    this.openWindow.set(key, now);

    const payload: AlertRaisedPayload = {
      alertId: ulid(),
      category: candidate.category,
      severity: candidate.severity,
      subject: candidate.subject,
      message: candidate.message,
      metadata: candidate.metadata,
      raisedAt: new Date(now).toISOString(),
      workerInstanceId: this.runtime.workerInstanceId,
    };

    this._raised += 1;

    this._lastRaisedAt = new Date(now);

    // DB first (idempotent on alertId) so a notify outage cannot lose
    // the record. Notify + Streams + BE audit are best-effort.
    try {
      await this.repo.insert(payload);
    } catch (err) {
      this.logger.warn(
        `alert insert failed (${payload.alertId}): ${err instanceof Error ? err.message : err}`,
      );
    }

    // Phase F: BE audit hook removed — the alert.raised stream event
    // flows to the notifier which records the audit row in `events`.
    await Promise.all([
      this.dispatchNotify(payload).catch((err) =>
        this.logger.warn(`notify failed: ${err instanceof Error ? err.message : err}`),
      ),
      this.dispatchStreams(payload).catch((err) =>
        this.logger.warn(`streams failed: ${err instanceof Error ? err.message : err}`),
      ),
    ]);
  }

  private async dispatchNotify(payload: AlertRaisedPayload): Promise<void> {
    // Phase 9: default to slack only. Phase 9.x routes severity to
    // additional channels (sms for critical, etc).
    const input: NotifyInput = {
      channel: { type: 'slack', config: {} },
      title: payload.subject,
      body: payload.message,
      severity: payload.severity as NotifySeverity,
      metadata: payload.metadata,
    };

    await this.notify.notify(input);
  }

  private async dispatchStreams(payload: AlertRaisedPayload): Promise<void> {
    const event = this.eventFactory.build({
      eventType: ALERT_RAISED_EVENT_TYPE,
      schemaVersion: ALERT_RAISED_SCHEMA_VERSION,
      role: 'detector',
      payload,
    });

    await this.streams.produce(ALERT_RAISED_STREAM, event);
  }
}
