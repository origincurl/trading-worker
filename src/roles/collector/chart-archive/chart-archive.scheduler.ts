import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CHART_ARCHIVE_CONFIG, type ChartArchiveConfig } from '@config/chart-archive.config';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.tokens';
import { ChartArchiveWriterService } from './chart-archive-writer.service';
import { ChartArchiveAlertService } from './chart-archive-alert.service';
import { ChartArchiveManifestRepository } from './chart-archive-manifest.repository';

const SCHEDULER_NAME = 'collector.chart-archive.daily';

@Injectable()
export class ChartArchiveScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChartArchiveScheduler.name);
  private lastRunTradeDate: string | null = null;

  constructor(
    @Inject(CHART_ARCHIVE_CONFIG) private readonly config: ChartArchiveConfig,
    private readonly registry: SchedulerRegistry,
    private readonly writer: ChartArchiveWriterService,
    private readonly alerts: ChartArchiveAlertService,
    private readonly manifests: ChartArchiveManifestRepository,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: RedisClientToken,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) return;
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    if (this.registry.doesExist('timeout', SCHEDULER_NAME)) {
      this.registry.deleteTimeout(SCHEDULER_NAME);
    }
  }

  private scheduleNext(): void {
    if (this.registry.doesExist('timeout', SCHEDULER_NAME)) {
      this.registry.deleteTimeout(SCHEDULER_NAME);
    }
    const next = nextKstRunAt(new Date(), this.config.timeKst);
    const delayMs = Math.max(1_000, next.getTime() - Date.now());
    const handle = setTimeout(() => {
      void this.tick().finally(() => this.scheduleNext());
    }, delayMs);
    this.registry.addTimeout(SCHEDULER_NAME, handle);
    this.logger.log(
      `scheduler ${SCHEDULER_NAME} next=${next.toISOString()} (${this.config.timeKst} KST)`,
    );
  }

  private async tick(now: Date = new Date()): Promise<void> {
    const tradeDate = new Date(now.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 10);
    if (this.lastRunTradeDate === tradeDate) return;
    const owner = `${process.pid}:${now.toISOString()}`;
    const lockKey = `worker:chart-archive:daily:kiwoom:${tradeDate}`;
    const acquired = this.redis
      ? await this.redis.set(lockKey, owner, 'EX', this.config.lockTtlSec, 'NX')
      : 'OK';
    if (acquired !== 'OK') return;
    this.lastRunTradeDate = tradeDate;
    try {
      await this.writer.archiveTradeDate(tradeDate);
      await this.writer.rebuildStaleDerivedManifests(100);
      await this.raiseProblemStatusAlerts(tradeDate);
    } catch (err) {
      await this.alerts.raise({
        category: 'chart-archive-failure',
        severity: 'critical',
        subject: `chart archive daily run failed ${tradeDate}`,
        message: err instanceof Error ? err.message : String(err),
        metadata: { tradeDate },
      });
      throw err;
    } finally {
      await this.releaseDailyLock(lockKey, owner);
    }
  }

  private async raiseProblemStatusAlerts(tradeDate: string): Promise<void> {
    const metrics = await this.manifests.latestMetrics();
    const staleCount = Number(metrics.stale_count ?? metrics.staleCount ?? 0);
    const mismatchCount = Number(metrics.mismatch_count ?? metrics.mismatchCount ?? 0);
    if (mismatchCount > 0) {
      await this.alerts.raise({
        category: 'chart-archive-mismatch',
        severity: 'critical',
        subject: `chart archive mismatch manifests detected ${tradeDate}`,
        message: `${mismatchCount} MISMATCH manifests exist in the latest archive window`,
        metadata: { tradeDate, mismatchCount: String(mismatchCount) },
      });
    }
    if (staleCount > 0) {
      await this.alerts.raise({
        category: 'chart-archive-failure',
        severity: 'warning',
        subject: `chart archive stale manifests detected ${tradeDate}`,
        message: `${staleCount} STALE manifests exist in the latest archive window`,
        metadata: { tradeDate, staleCount: String(staleCount) },
      });
    }
  }

  private async releaseDailyLock(lockKey: string, owner: string): Promise<void> {
    if (!this.redis) return;
    await this.redis
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        owner,
      )
      .catch((err) =>
        this.logger.warn(`daily archive lock release failed: ${err instanceof Error ? err.message : err}`),
      );
  }
}

function nextKstRunAt(now: Date, hhmm: string): Date {
  const [hourRaw, minuteRaw] = hhmm.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const kstNow = new Date(now.getTime() + 9 * 60 * 60_000);
  const targetKstMs = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate(),
    hour,
    minute,
    0,
    0,
  );
  const targetUtc = new Date(targetKstMs - 9 * 60 * 60_000);
  if (targetUtc.getTime() <= now.getTime()) {
    targetUtc.setUTCDate(targetUtc.getUTCDate() + 1);
  }
  return targetUtc;
}
