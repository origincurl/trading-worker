import type { NotifyChannelType } from '../notify.token';

export interface SmsChannelConfig {
  readonly to: string;
}

export interface TelegramChannelConfig {
  readonly chatId: string;
}

export interface DiscordChannelConfig {
  readonly webhookUrl?: string;
  readonly channelId?: string;
}

export interface SlackChannelConfig {
  readonly webhookUrl?: string;
  readonly channel?: string;
}

export interface PushChannelConfig {
  readonly deviceToken: string;
  readonly platform?: 'ios' | 'android' | 'web';
}

export type NotifyChannelConfig =
  | { type: 'sms'; config: SmsChannelConfig }
  | { type: 'telegram'; config: TelegramChannelConfig }
  | { type: 'discord'; config: DiscordChannelConfig }
  | { type: 'slack'; config: SlackChannelConfig }
  | { type: 'push'; config: PushChannelConfig };

export interface NotifyChannelModel {
  readonly type: NotifyChannelType;
  readonly config: NotifyChannelConfig['config'];
}
