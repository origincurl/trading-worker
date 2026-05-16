// Slack incoming-webhook payload. Vendor-internal.
export interface SlackWebhookRequestContract {
  readonly text: string;
  readonly attachments?: ReadonlyArray<{
    readonly color?: string;
    readonly title?: string;
    readonly text?: string;
    readonly fields?: ReadonlyArray<{
      readonly title: string;
      readonly value: string;
      readonly short?: boolean;
    }>;
  }>;
}
