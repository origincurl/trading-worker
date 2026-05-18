import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { NOTIFIER_CONFIG, type NotifierConfig } from '@config/notifier.config';
import { DispatchNotificationOutboxUsecase } from '@roles/notifier/usecase/dispatch-notification-outbox.usecase';

// Registers a dynamic interval so the tick period reads from
// NOTIFIER_OUTBOX_TICK_MS at boot (the @Interval decorator wants a
// compile-time constant). One tick at a time — overlapping runs would
// double-claim PENDING rows even with SKIP LOCKED at the row level.
@Injectable()
export class NotificationOutboxScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationOutboxScheduler.name);

  private readonly intervalName = 'notifier.outbox-dispatch';

  private running = false;

  constructor(
    @Inject(NOTIFIER_CONFIG) private readonly config: NotifierConfig,
    private readonly registry: SchedulerRegistry,
    private readonly usecase: DispatchNotificationOutboxUsecase,
  ) {}

  onApplicationBootstrap(): void {
    if (this.registry.doesExist('interval', this.intervalName)) return;

    const handle = setInterval(() => {
      void this.tick();
    }, this.config.outboxTickMs);

    this.registry.addInterval(this.intervalName, handle);

    this.logger.log(`outbox dispatcher running every ${this.config.outboxTickMs}ms`);
  }

  private async tick(): Promise<void> {
    if (this.running) return;

    this.running = true;

    try {
      await this.usecase.execute();
    } catch (err) {
      this.logger.warn(`outbox tick failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.running = false;
    }
  }
}
