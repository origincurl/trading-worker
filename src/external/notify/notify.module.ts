import { Global, Module } from '@nestjs/common';
import { NotifyVendorResolver } from './service/notify-vendor.resolver';
import { NOTIFY_VENDOR } from './notify.token';
import { DiscordNotifyVendor } from './platforms/discord/discord-notify.vendor';
import { PushNotifyVendor } from './platforms/push/push-notify.vendor';
import { SlackNotifyVendor } from './platforms/slack/slack-notify.vendor';
import { SmsNotifyVendor } from './platforms/sms/sms-notify.vendor';
import { TelegramNotifyVendor } from './platforms/telegram/telegram-notify.vendor';

@Global()
@Module({
  providers: [
    SmsNotifyVendor,
    TelegramNotifyVendor,
    DiscordNotifyVendor,
    SlackNotifyVendor,
    PushNotifyVendor,
    NotifyVendorResolver,
    { provide: NOTIFY_VENDOR, useExisting: NotifyVendorResolver },
  ],
  exports: [NOTIFY_VENDOR],
})
export class NotifyModule {}
