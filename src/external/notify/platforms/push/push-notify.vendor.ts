import { Injectable, Logger } from '@nestjs/common';
import type { NotifyVendor, NotifyInput } from '../../vendor/notify.vendor';
import type { PushChannelConfig } from '../../model/notify-channel.model';
import type { NotifyResultModel } from '../../model/notify-result.model';

// Mock Push (mobile / web push) vendor. Real FCM / APNs / Web Push
// integration will be added in a follow-up phase along with contract +
// api-client.
@Injectable()
export class PushNotifyVendor implements NotifyVendor {
  private readonly logger = new Logger(PushNotifyVendor.name);

  async notify(input: NotifyInput): Promise<NotifyResultModel> {
    const cfg = input.channel.config as PushChannelConfig;

    this.logger.log(
      `[MOCK PUSH] platform=${cfg.platform ?? 'unknown'} token=${maskToken(cfg.deviceToken)} severity=${input.severity} title="${input.title}"`,
    );

    return {
      status: 'delivered',
      vendor: 'push',
      attemptedAt: new Date().toISOString(),
      reason: 'mock impl',
    };
  }
}

function maskToken(token: string): string {
  if (!token) return '<empty>';
  if (token.length <= 8) return '***';

  return `${token.slice(0, 4)}***${token.slice(-4)}`;
}
