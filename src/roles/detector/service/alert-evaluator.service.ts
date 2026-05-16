import { Inject, Injectable } from '@nestjs/common';
import type { AlertCategory, AlertSeverity } from '@shared/event/alert-raised.event';
import {
  ALERT_REPOSITORY,
  type AlertRepository,
} from '@roles/detector/repository/alert.repository';

export interface AlertCandidate {
  readonly category: AlertCategory;
  readonly severity: AlertSeverity;
  readonly subjectKey: string;
  readonly subject: string;
  readonly message: string;
  readonly metadata?: Record<string, string>;
}

// Phase 9 thresholds. Conservative defaults — operators can tune via env
// in Phase 9.x. Each rule queries the same 60s window.
const WINDOW_MS = 60_000;
const DEAD_LETTER_WARNING = 50;
const DEAD_LETTER_CRITICAL = 200;
const FAILED_ORDER_WARNING = 5;
const FAILED_ORDER_CRITICAL = 20;

@Injectable()
export class AlertEvaluator {
  constructor(@Inject(ALERT_REPOSITORY) private readonly repo: AlertRepository) {}

  async evaluate(): Promise<AlertCandidate[]> {
    const since = Date.now() - WINDOW_MS;
    const candidates: AlertCandidate[] = [];

    const deadLetters = await this.repo.countDeadLettersSince(since);

    if (deadLetters >= DEAD_LETTER_CRITICAL) {
      candidates.push({
        category: 'dead-letter-spike',
        severity: 'critical',
        subjectKey: 'collector.dead-letter',
        subject: `Collector dead-letter spike: ${deadLetters}/1m`,
        message: `${deadLetters} dead-letter records in the last 60s exceeds CRITICAL threshold ${DEAD_LETTER_CRITICAL}.`,
        metadata: { count: String(deadLetters), windowMs: String(WINDOW_MS) },
      });
    } else if (deadLetters >= DEAD_LETTER_WARNING) {
      candidates.push({
        category: 'dead-letter-spike',
        severity: 'warning',
        subjectKey: 'collector.dead-letter',
        subject: `Collector dead-letter elevated: ${deadLetters}/1m`,
        message: `${deadLetters} dead-letter records in the last 60s exceeds WARNING threshold ${DEAD_LETTER_WARNING}.`,
        metadata: { count: String(deadLetters), windowMs: String(WINDOW_MS) },
      });
    }

    const failed = await this.repo.countFailedOrdersSince(since);

    if (failed >= FAILED_ORDER_CRITICAL) {
      candidates.push({
        category: 'order-rejection-spike',
        severity: 'critical',
        subjectKey: 'executor.order-failed',
        subject: `Order failure spike: ${failed}/1m`,
        message: `${failed} order_attempt rows with status=failed in the last 60s exceeds CRITICAL threshold ${FAILED_ORDER_CRITICAL}.`,
        metadata: { count: String(failed), windowMs: String(WINDOW_MS) },
      });
    } else if (failed >= FAILED_ORDER_WARNING) {
      candidates.push({
        category: 'order-rejection-spike',
        severity: 'warning',
        subjectKey: 'executor.order-failed',
        subject: `Order failures elevated: ${failed}/1m`,
        message: `${failed} failed order attempts in the last 60s exceeds WARNING threshold ${FAILED_ORDER_WARNING}.`,
        metadata: { count: String(failed), windowMs: String(WINDOW_MS) },
      });
    }

    return candidates;
  }
}
