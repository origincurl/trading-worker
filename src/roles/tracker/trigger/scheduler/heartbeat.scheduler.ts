import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { REDIS_CONFIG, type RedisConfig } from '@config/redis.config';
import { HeartbeatUsecase } from '@roles/tracker/usecase/heartbeat.usecase';

@Injectable()
export class HeartbeatScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatScheduler.name);

  private timer: NodeJS.Timeout | null = null;

  private running = false;

  constructor(
    private readonly usecase: HeartbeatUsecase,
    @Inject(REDIS_CONFIG) private readonly redis: RedisConfig,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.redis.heartbeatIntervalSec * 1000;

    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    this.logger.log(`scheduler tracker.heartbeat every ${this.redis.heartbeatIntervalSec}s`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      await this.usecase.execute();
    } catch (err) {
      this.logger.warn(`tracker heartbeat failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.running = false;
    }
  }
}
