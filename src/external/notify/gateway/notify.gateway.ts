import type { NotifyChannelModel } from '../model/notify-channel.model';
import type { NotifyResultModel } from '../model/notify-result.model';

export type NotifySeverity = 'info' | 'warning' | 'critical';

export interface NotifyInput {
  readonly channel: NotifyChannelModel;
  readonly title: string;
  readonly body: string;
  readonly severity: NotifySeverity;
  readonly metadata?: Record<string, string>;
}

export interface NotifyGateway {
  notify(input: NotifyInput): Promise<NotifyResultModel>;
}
