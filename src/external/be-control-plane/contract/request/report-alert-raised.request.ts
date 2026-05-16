export interface ReportAlertRaisedRequestContract {
  readonly alertId: string;
  readonly category: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly subject: string;
  readonly message: string;
  readonly raisedAt: string;
  readonly metadata?: Record<string, string>;
}
