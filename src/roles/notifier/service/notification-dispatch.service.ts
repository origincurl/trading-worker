import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  NotifyVendor,
  NotifyInput,
  NotifySeverity,
} from '@external/notify/vendor/notify.vendor';
import type { NotifyResultModel } from '@external/notify/model/notify-result.model';
import { NOTIFY_VENDOR, type NotifyChannelType } from '@external/notify/notify.token';

export interface DispatchInput {
  readonly channelType: string;
  readonly channelConfig: Record<string, unknown>;
  readonly title: string;
  readonly body: string;
  readonly level: 'info' | 'warning' | 'critical';
}

const SUPPORTED_CHANNEL_TYPES: ReadonlySet<NotifyChannelType> = new Set<NotifyChannelType>([
  'sms',
  'telegram',
  'discord',
  'slack',
  'push',
]);

@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(@Inject(NOTIFY_VENDOR) private readonly notify: NotifyVendor) {}

  async dispatch(input: DispatchInput): Promise<NotifyResultModel> {
    if (!this.isSupportedChannelType(input.channelType)) {
      return {
        status: 'skipped',
        vendor: input.channelType,
        attemptedAt: new Date().toISOString(),
        reason: `unsupported channel type: ${input.channelType}`,
      };
    }

    const notifyInput: NotifyInput = {
      channel: {
        type: input.channelType,
        config: input.channelConfig as NotifyInput['channel']['config'],
      },
      title: input.title,
      body: input.body,
      severity: this.toSeverity(input.level),
    };

    return this.notify.notify(notifyInput);
  }

  private isSupportedChannelType(value: string): value is NotifyChannelType {
    return SUPPORTED_CHANNEL_TYPES.has(value as NotifyChannelType);
  }

  private toSeverity(level: 'info' | 'warning' | 'critical'): NotifySeverity {
    return level;
  }
}
