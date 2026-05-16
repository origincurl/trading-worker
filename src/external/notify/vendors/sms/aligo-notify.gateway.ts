import { Logger } from '@nestjs/common';
import type { NotifyGateway, NotifyInput } from '../../gateway/notify.gateway';
import type { NotifyResultModel } from '../../model/notify-result.model';

// Skeleton — returns `skipped` until the Aligo integration is wired.
export class AligoNotifyGateway implements NotifyGateway {
  private readonly logger = new Logger(AligoNotifyGateway.name);

  async notify(input: NotifyInput): Promise<NotifyResultModel> {
    void input;

    return {
      status: 'skipped',
      vendor: 'aligo',
      attemptedAt: new Date().toISOString(),
      reason: 'SMS vendor not implemented',
    };
  }
}
