import { Logger } from '@nestjs/common';
import type { NotifyConfig } from '@config/notify.config';
import type { NotifyGateway, NotifyInput } from '../../gateway/notify.gateway';
import type { EmailChannelConfig } from '../../model/notify-channel.model';
import type { NotifyResultModel } from '../../model/notify-result.model';
import { SmtpApiClient } from './smtp.api-client';

export class SmtpNotifyGateway implements NotifyGateway {
  private readonly logger = new Logger(SmtpNotifyGateway.name);

  private readonly apiClient?: SmtpApiClient;

  constructor(private readonly config: NotifyConfig) {
    if (config.smtp) {
      this.apiClient = new SmtpApiClient({
        host: config.smtp.host,
        port: config.smtp.port,
        user: config.smtp.user,
        pass: config.smtp.pass,
      });
    }
  }

  async notify(input: NotifyInput): Promise<NotifyResultModel> {
    const channel = input.channel.config as EmailChannelConfig;
    const now = new Date().toISOString();

    if (!this.apiClient) {
      return {
        status: 'skipped',
        vendor: 'smtp',
        attemptedAt: now,
        reason: 'SMTP not configured (SMTP_HOST/SMTP_PORT missing)',
      };
    }

    if (!channel.to) {
      return {
        status: 'skipped',
        vendor: 'smtp',
        attemptedAt: now,
        reason: 'channel.to missing',
      };
    }

    const from = channel.from ?? this.config.smtp?.user ?? 'no-reply@worker.local';
    const metadataBlock = input.metadata
      ? '\n\n' +
        Object.entries(input.metadata)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
      : '';

    try {
      await this.apiClient.send({
        from,
        to: channel.to,
        subject: `[${input.severity.toUpperCase()}] ${input.title}`,
        text: `${input.body}${metadataBlock}`,
      });

      return { status: 'delivered', vendor: 'smtp', attemptedAt: now };
    } catch (err) {
      return {
        status: 'failed',
        vendor: 'smtp',
        attemptedAt: now,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
