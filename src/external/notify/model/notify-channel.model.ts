import type { NotifyChannelType } from '../notify.token';

export interface SlackChannelConfig {
  readonly webhookUrl?: string;
}

export interface EmailChannelConfig {
  readonly to: string;
  readonly from?: string;
}

export interface SmsChannelConfig {
  readonly to: string;
}

export type NotifyChannelConfig =
  | { type: 'slack'; config: SlackChannelConfig }
  | { type: 'email'; config: EmailChannelConfig }
  | { type: 'sms'; config: SmsChannelConfig };

export interface NotifyChannelModel {
  readonly type: NotifyChannelType;
  readonly config: NotifyChannelConfig['config'];
}
