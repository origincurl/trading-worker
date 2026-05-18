import { Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import type { NotifyVendor, NotifyInput } from '../vendor/notify.vendor';
import type { NotifyResultModel } from '../model/notify-result.model';
import type { NotifyChannelType } from '../notify.token';
import { DiscordNotifyVendor } from '../platforms/discord/discord-notify.vendor';
import { PushNotifyVendor } from '../platforms/push/push-notify.vendor';
import { SlackNotifyVendor } from '../platforms/slack/slack-notify.vendor';
import { SmsNotifyVendor } from '../platforms/sms/sms-notify.vendor';
import { TelegramNotifyVendor } from '../platforms/telegram/telegram-notify.vendor';

// Routes by channel.type. Implements NotifyVendor so callers can inject
// the resolver under the NOTIFY_VENDOR token without knowing per-platform
// classes. Supported platforms: SMS, TELEGRAM, DISCORD, SLACK, PUSH (all
// currently mock impls — contract + api-client to be added per platform
// in a follow-up phase).
@Injectable()
export class NotifyVendorResolver implements NotifyVendor {
  private readonly logger = new Logger(NotifyVendorResolver.name);

  private readonly vendors: Record<NotifyChannelType, NotifyVendor>;

  constructor(
    sms: SmsNotifyVendor,
    telegram: TelegramNotifyVendor,
    discord: DiscordNotifyVendor,
    slack: SlackNotifyVendor,
    push: PushNotifyVendor,
  ) {
    this.vendors = { sms, telegram, discord, slack, push };
  }

  async notify(input: NotifyInput): Promise<NotifyResultModel> {
    const vendor = this.vendors[input.channel.type];

    if (!vendor) {
      throw new DomainError(
        `unknown notify channel type: ${input.channel.type as string}`,
        'NOTIFY_CHANNEL_UNKNOWN',
      );
    }

    return vendor.notify(input);
  }
}
