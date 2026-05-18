import { Injectable, Logger } from '@nestjs/common';
import type { NotifyVendor, NotifyInput } from '../../vendor/notify.vendor';
import type { SlackChannelConfig } from '../../model/notify-channel.model';
import type { NotifyResultModel } from '../../model/notify-result.model';

// Mock Slack vendor. Real Slack webhook integration will be added in a
// follow-up phase along with contract + api-client.
@Injectable()
export class SlackNotifyVendor implements NotifyVendor {
  private readonly logger = new Logger(SlackNotifyVendor.name);

  async notify(input: NotifyInput): Promise<NotifyResultModel> {
    const cfg = input.channel.config as SlackChannelConfig;

    this.logger.log(
      `[MOCK SLACK] webhookUrl=${cfg.webhookUrl ?? '(default)'} channel=${cfg.channel ?? '-'} severity=${input.severity} title="${input.title}"`,
    );

    return {
      status: 'delivered',
      vendor: 'slack',
      attemptedAt: new Date().toISOString(),
      reason: 'mock impl',
    };
  }
}
