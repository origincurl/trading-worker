import { Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import type { NotifyGateway, NotifyInput } from '../gateway/notify.gateway';
import type { NotifyResultModel } from '../model/notify-result.model';
import type { NotifyChannelType } from '../notify.token';
import { AligoNotifyGateway } from '../vendors/sms/aligo-notify.gateway';
import { SlackNotifyGateway } from '../vendors/slack/slack-notify.gateway';
import { SmtpNotifyGateway } from '../vendors/email/smtp-notify.gateway';

// Routes by channel.type. Implements NotifyGateway so detector code can
// inject the resolver under the NOTIFY_GATEWAY token without knowing about
// per-vendor classes.
@Injectable()
export class NotifyGatewayResolver implements NotifyGateway {
  private readonly logger = new Logger(NotifyGatewayResolver.name);

  private readonly vendors: Record<NotifyChannelType, NotifyGateway>;

  constructor(slack: SlackNotifyGateway, smtp: SmtpNotifyGateway, sms: AligoNotifyGateway) {
    this.vendors = { slack, email: smtp, sms };
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
