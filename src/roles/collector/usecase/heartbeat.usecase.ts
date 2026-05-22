import { Injectable, Logger } from '@nestjs/common';
import { HeartbeatWriter } from '@shared/cache/heartbeat.writer';
import { CollectorStatusService } from '../service/collector-status.service';

// Phase 9: also writes a redis heartbeat key with collector-specific
// metrics (universe_size, observed_fe_count, strategy_desired_count,
// active_subscriptions) so BE admin dashboards can render collector
// fleet state without scraping logs.
@Injectable()
export class HeartbeatUsecase {
  private readonly logger = new Logger(HeartbeatUsecase.name);

  constructor(
    private readonly status: CollectorStatusService,
    private readonly writer: HeartbeatWriter,
  ) {}

  async execute(): Promise<void> {
    const metrics = this.status.getMetrics();

    await this.writer.tick(metrics, { subscriptionState: this.status.getSubscriptionState() });

    const status = this.status.getStatus();

    this.logger.log(`collector heartbeat: ${status.detail ?? 'ready'}`);
  }
}
