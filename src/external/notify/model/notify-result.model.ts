export type NotifyDeliveryStatus = 'delivered' | 'skipped' | 'failed';

export interface NotifyResultModel {
  readonly status: NotifyDeliveryStatus;
  readonly vendor: string;
  readonly attemptedAt: string;
  readonly reason?: string;
}
