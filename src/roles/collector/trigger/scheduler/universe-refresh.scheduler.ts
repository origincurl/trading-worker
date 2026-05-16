import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { RefreshUniverseUsecase } from '@roles/collector/usecase/refresh-universe.usecase';

const REFRESH_INTERVAL_MS = 60_000;

@Injectable()
export class UniverseRefreshScheduler {
  private readonly logger = new Logger(UniverseRefreshScheduler.name);

  constructor(private readonly usecase: RefreshUniverseUsecase) {}

  @Interval('collector.universe-refresh', REFRESH_INTERVAL_MS)
  async tick(): Promise<void> {
    try {
      await this.usecase.execute();
    } catch (err) {
      this.logger.warn(`universe refresh failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
