import { Injectable, Logger } from '@nestjs/common';
import type { NotifyVendor, NotifyInput } from '../../vendor/notify.vendor';
import type { DiscordChannelConfig } from '../../model/notify-channel.model';
import type { NotifyResultModel } from '../../model/notify-result.model';

// Mock Discord vendor. Real Discord webhook / bot integration will be added
// in a follow-up phase along with contract + api-client.
@Injectable()
export class DiscordNotifyVendor implements NotifyVendor {
  private readonly logger = new Logger(DiscordNotifyVendor.name);

  async notify(input: NotifyInput): Promise<NotifyResultModel> {
    const cfg = input.channel.config as DiscordChannelConfig;

    this.logger.log(
      `[MOCK DISCORD] webhookUrl=${cfg.webhookUrl ?? 'channelId=' + (cfg.channelId ?? '?')} severity=${input.severity} title="${input.title}"`,
    );

    return {
      status: 'delivered',
      vendor: 'discord',
      attemptedAt: new Date().toISOString(),
      reason: 'mock impl',
    };
  }
}
