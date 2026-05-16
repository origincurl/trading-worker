import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { IntegrationError } from '@common/error/domain.error';

export interface SmtpClientOptions {
  readonly host: string;
  readonly port: number;
  readonly user?: string;
  readonly pass?: string;
}

export interface SendMailInput {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export class SmtpApiClient {
  private readonly logger = new Logger(SmtpApiClient.name);

  private transporter?: Transporter;

  constructor(private readonly opts: SmtpClientOptions) {}

  async send(input: SendMailInput): Promise<void> {
    const transporter = this.getTransporter();

    try {
      await transporter.sendMail({
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
    } catch (err) {
      throw new IntegrationError('SMTP send failed', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    this.transporter = createTransport({
      host: this.opts.host,
      port: this.opts.port,
      secure: this.opts.port === 465,
      auth:
        this.opts.user && this.opts.pass
          ? { user: this.opts.user, pass: this.opts.pass }
          : undefined,
    });

    return this.transporter;
  }
}
