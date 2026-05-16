import { Global, Module, type Provider } from '@nestjs/common';
import { NOTIFY_CONFIG, type NotifyConfig } from '@config/notify.config';
import { NotifyGatewayResolver } from './service/notify-gateway.resolver';
import { NOTIFY_GATEWAY } from './notify.token';
import { AligoNotifyGateway } from './vendors/sms/aligo-notify.gateway';
import { SlackApiClient } from './vendors/slack/slack.api-client';
import { SlackNotifyGateway } from './vendors/slack/slack-notify.gateway';
import { SmtpNotifyGateway } from './vendors/email/smtp-notify.gateway';

const slackProvider: Provider = {
  provide: SlackNotifyGateway,
  inject: [NOTIFY_CONFIG],
  useFactory: (config: NotifyConfig) => new SlackNotifyGateway(new SlackApiClient(), config),
};

const smtpProvider: Provider = {
  provide: SmtpNotifyGateway,
  inject: [NOTIFY_CONFIG],
  useFactory: (config: NotifyConfig) => new SmtpNotifyGateway(config),
};

const aligoProvider: Provider = {
  provide: AligoNotifyGateway,
  useClass: AligoNotifyGateway,
};

@Global()
@Module({
  providers: [
    slackProvider,
    smtpProvider,
    aligoProvider,
    NotifyGatewayResolver,
    { provide: NOTIFY_GATEWAY, useExisting: NotifyGatewayResolver },
  ],
  exports: [NOTIFY_GATEWAY],
})
export class NotifyModule {}
