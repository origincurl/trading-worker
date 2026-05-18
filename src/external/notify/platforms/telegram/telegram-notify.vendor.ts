import { Injectable, Logger } from '@nestjs/common';
import type { NotifyVendor, NotifyInput } from '../../vendor/notify.vendor';
import type { TelegramChannelConfig } from '../../model/notify-channel.model';
import type { NotifyResultModel } from '../../model/notify-result.model';

// Mock Telegram vendor. Real Telegram Bot API integration will be added
// in a follow-up phase along with contract + api-client.
@Injectable()
export class TelegramNotifyVendor implements NotifyVendor {
  private readonly logger = new Logger(TelegramNotifyVendor.name);

  async notify(input: NotifyInput): Promise<NotifyResultModel> {
    const cfg = input.channel.config as TelegramChannelConfig;

    this.logger.log(
      `[MOCK TELEGRAM] chatId=${cfg.chatId} severity=${input.severity} title="${input.title}"`,
    );

    return {
      status: 'delivered',
      vendor: 'telegram',
      attemptedAt: new Date().toISOString(),
      reason: 'mock impl',
    };
  }
}
