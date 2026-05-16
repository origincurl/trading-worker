import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { HeartbeatUsecase } from '@roles/collector/usecase/heartbeat.usecase';

const HEARTBEAT_INTERVAL_MS = 60_000;

@Injectable()
export class HeartbeatScheduler {
  private readonly logger = new Logger(HeartbeatScheduler.name);

  constructor(private readonly usecase: HeartbeatUsecase) {}

  @Interval('collector.heartbeat', HEARTBEAT_INTERVAL_MS)
  async tick(): Promise<void> {
    try {
      await this.usecase.execute();
    } catch (err) {
      this.logger.warn(`collector heartbeat failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
