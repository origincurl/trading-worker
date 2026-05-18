import { Injectable, Logger } from '@nestjs/common';
import type { NotifyVendor, NotifyInput } from '../../vendor/notify.vendor';
import type { SmsChannelConfig } from '../../model/notify-channel.model';
import type { NotifyResultModel } from '../../model/notify-result.model';

// Mock SMS vendor. Real platform integration (Aligo / Twilio / NHN Cloud)
// will be added in a follow-up phase along with contract + api-client.
@Injectable()
export class SmsNotifyVendor implements NotifyVendor {
  private readonly logger = new Logger(SmsNotifyVendor.name);

  async notify(input: NotifyInput): Promise<NotifyResultModel> {
    const cfg = input.channel.config as SmsChannelConfig;

    this.logger.log(
      `[MOCK SMS] to=${cfg.to} severity=${input.severity} title="${input.title}"`,
    );

    return {
      status: 'delivered',
      vendor: 'sms',
      attemptedAt: new Date().toISOString(),
      reason: 'mock impl',
    };
  }
}
