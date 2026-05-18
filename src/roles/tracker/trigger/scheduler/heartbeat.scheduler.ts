import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { HeartbeatUsecase } from '@roles/tracker/usecase/heartbeat.usecase';

const HEARTBEAT_INTERVAL_MS = 60_000;

@Injectable()
export class HeartbeatScheduler {
  private readonly logger = new Logger(HeartbeatScheduler.name);

  constructor(private readonly usecase: HeartbeatUsecase) {}

  @Interval('tracker.heartbeat', HEARTBEAT_INTERVAL_MS)
  async tick(): Promise<void> {
    try {
      await this.usecase.execute();
    } catch (err) {
      this.logger.warn(`tracker heartbeat failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
