import { Logger } from '@nestjs/common';
import type { NotifyConfig } from '@config/notify.config';
import type { NotifyGateway, NotifyInput } from '../../gateway/notify.gateway';
import type { SlackChannelConfig } from '../../model/notify-channel.model';
import type { NotifyResultModel } from '../../model/notify-result.model';
import type { SlackWebhookRequestContract } from './contract/slack-webhook.request';
import { SlackApiClient } from './slack.api-client';

const SEVERITY_COLOR: Record<NotifyInput['severity'], string> = {
  info: '#36a64f',
  warning: '#f2c744',
  critical: '#cc0033',
};

export class SlackNotifyGateway implements NotifyGateway {
  private readonly logger = new Logger(SlackNotifyGateway.name);

  constructor(
    private readonly apiClient: SlackApiClient,
    private readonly config: NotifyConfig,
  ) {}

  async notify(input: NotifyInput): Promise<NotifyResultModel> {
    const webhookUrl = this.resolveWebhookUrl(input.channel.config as SlackChannelConfig);

    if (!webhookUrl) {
      return {
        status: 'skipped',
        vendor: 'slack',
        attemptedAt: new Date().toISOString(),
        reason: 'no webhook url configured (channel or default)',
      };
    }

    const payload: SlackWebhookRequestContract = {
      text: input.title,
      attachments: [
        {
          color: SEVERITY_COLOR[input.severity],
          title: input.title,
          text: input.body,
          fields: input.metadata
            ? Object.entries(input.metadata).map(([title, value]) => ({
                title,
                value,
                short: true,
              }))
            : undefined,
        },
      ],
    };

    try {
      await this.apiClient.postWebhook(webhookUrl, payload);

      return {
        status: 'delivered',
        vendor: 'slack',
        attemptedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        status: 'failed',
        vendor: 'slack',
        attemptedAt: new Date().toISOString(),
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private resolveWebhookUrl(channelConfig: SlackChannelConfig): string | undefined {
    return channelConfig.webhookUrl ?? this.config.slack?.defaultWebhookUrl;
  }
}
