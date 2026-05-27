import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { COLLECTOR_CONFIG, type CollectorConfig } from '@config/collector.config';
import { FxSnapshotService } from '@roles/collector/service/fx-snapshot.service';
import { MarketDashboardSnapshotService } from '@roles/collector/service/market-dashboard-snapshot.service';
import { MarketIndexSnapshotService } from '@roles/collector/service/market-index-snapshot.service';

const INDEX_SCHEDULER_NAME = 'collector.index-snapshot';
const FX_SCHEDULER_NAME = 'collector.fx-snapshot';
const DASHBOARD_SCHEDULER_NAME = 'collector.dashboard-market-snapshot';

@Injectable()
export class MarketSnapshotScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketSnapshotScheduler.name);

  private indexRunning = false;
  private fxRunning = false;
  private dashboardRunning = false;

  constructor(
    @Inject(COLLECTOR_CONFIG) private readonly config: CollectorConfig,
    private readonly registry: SchedulerRegistry,
    private readonly index: MarketIndexSnapshotService,
    private readonly fx: FxSnapshotService,
    private readonly dashboard: MarketDashboardSnapshotService,
  ) {}

  onModuleInit(): void {
    if (!this.config.marketSnapshotEnabled) {
      this.logger.log(
        'periodic market snapshot refresh disabled via COLLECTOR_MARKET_SNAPSHOT_ENABLED=false',
      );

      return;
    }

    this.register(INDEX_SCHEDULER_NAME, this.config.indexIntervalSec, () => this.refreshIndex());
    this.register(FX_SCHEDULER_NAME, this.config.fxIntervalSec, () => this.refreshFx());
    this.register(DASHBOARD_SCHEDULER_NAME, this.config.dashboardIntervalSec, () =>
      this.refreshDashboard(),
    );

    void this.refreshFx();
    void this.refreshDashboard();
  }

  onModuleDestroy(): void {
    this.deleteInterval(INDEX_SCHEDULER_NAME);
    this.deleteInterval(FX_SCHEDULER_NAME);
    this.deleteInterval(DASHBOARD_SCHEDULER_NAME);
  }

  private register(name: string, intervalSec: number, tick: () => Promise<void>): void {
    const handle = setInterval(() => void tick(), intervalSec * 1000);
    handle.unref?.();
    this.registry.addInterval(name, handle);
    this.logger.log(`scheduler ${name} every ${intervalSec}s`);
  }

  private deleteInterval(name: string): void {
    if (!this.registry.doesExist('interval', name)) return;

    this.registry.deleteInterval(name);
  }

  private async refreshFx(): Promise<void> {
    if (this.fxRunning) return;
    this.fxRunning = true;

    try {
      await this.fx.refresh();
    } catch (err) {
      this.logger.warn(`fx refresh failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.fxRunning = false;
    }
  }


  private async refreshDashboard(): Promise<void> {
    if (this.dashboardRunning) return;
    this.dashboardRunning = true;

    try {
      await this.dashboard.refresh();
    } catch (err) {
      this.logger.warn(`dashboard market refresh failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.dashboardRunning = false;
    }
  }

  private async refreshIndex(): Promise<void> {
    if (this.indexRunning) return;
    this.indexRunning = true;

    try {
      await this.index.refresh();
    } catch (err) {
      this.logger.warn(`market index refresh failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.indexRunning = false;
    }
  }
}

