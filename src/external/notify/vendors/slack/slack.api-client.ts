import { Logger } from '@nestjs/common';
import { IntegrationError } from '@common/error/domain.error';
import type { SlackWebhookRequestContract } from './contract/slack-webhook.request';

// Minimal Slack incoming-webhook client. No retry logic here — the caller
// (SlackNotifyGateway → detector usecase) decides on retry policy.
export class SlackApiClient {
  private readonly logger = new Logger(SlackApiClient.name);

  async postWebhook(webhookUrl: string, payload: SlackWebhookRequestContract): Promise<void> {
    let res: Response;

    try {
      res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new IntegrationError('Slack webhook network error', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');

      throw new IntegrationError(`Slack webhook HTTP ${res.status}`, {
        status: res.status,
        body: body.slice(0, 256),
      });
    }
  }
}
