export const ALERT_RAISED_EVENT_TYPE = 'alert.raised';
export const ALERT_RAISED_SCHEMA_VERSION = 1;
export const ALERT_RAISED_STREAM = 'alert.raised';

export type AlertCategory = 'dead-letter-spike' | 'order-rejection-spike' | 'stale-tick';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertRaisedPayload {
  readonly alertId: string;
  readonly category: AlertCategory;
  readonly severity: AlertSeverity;
  readonly subject: string;
  readonly message: string;
  readonly metadata?: Record<string, string>;
  readonly raisedAt: string;
  readonly workerInstanceId: string;
}
