import { forwardRef, Inject, Injectable } from '@nestjs/common';
import type { HeartbeatMetrics } from '@shared/cache/heartbeat.writer';
import type { RoleStatus, RoleStatusProvider } from '@roles/role-status';
import { KiwoomTickSubscriber } from '@roles/collector/trigger/subscriber/kiwoom-tick.subscriber';
import { IngestTickUsecase } from '@roles/collector/usecase/ingest-tick.usecase';
import { RefreshUniverseUsecase } from '@roles/collector/usecase/refresh-universe.usecase';
import { CandleBuilderService } from './candle-builder.service';
import { CandleCloseService } from './candle-close.service';
import { MarketOrderbookService } from './market-orderbook.service';
import { MarketTickService } from './market-tick.service';
import { UniverseService } from './universe.service';

@Injectable()
export class CollectorStatusService implements RoleStatusProvider {
  private readonly bootedAt = Date.now();

  constructor(
    @Inject(forwardRef(() => KiwoomTickSubscriber))
    private readonly subscriber: KiwoomTickSubscriber,
    private readonly tickService: MarketTickService,
    private readonly orderbookService: MarketOrderbookService,
    private readonly candleBuilder: CandleBuilderService,
    private readonly candleClose: CandleCloseService,
    private readonly universe: UniverseService,
    private readonly refreshUniverse: RefreshUniverseUsecase,
    private readonly ingestUsecase: IngestTickUsecase,
  ) {}

  // Phase 9 heartbeat surface: the metrics block written to redis under
  // the worker heartbeat key. BE admin reads these to render fleet state
  // (per-source observation counts, current subscription depth) without
  // having to scrape logs.
  getMetrics(): HeartbeatMetrics {
    return {
      universe_size: this.universe.size(),
      observed_admin_count: this.universe.observedAdminCount(),
      observed_fe_count: this.universe.observedFeCount(),
      active_subscriptions: this.refreshUniverse.actualSubscriptionCount(),
    };
  }

  getStatus(): RoleStatus {
    const subscribed = this.refreshUniverse.actualSubscriptionCount();
    const last = this.tickService.lastTickAt();
    const lastOb = this.orderbookService.lastSnapshotAt();
    const lastClose = this.candleClose.lastClosedAt();
    const stats = this.ingestUsecase.snapshotStats();
    const openBuckets = this.candleBuilder.openBuckets().length;
    const universeSize = this.universe.size();
    const adminCount = this.universe.observedAdminCount();
    const feCount = this.universe.observedFeCount();
    const lastRefresh = this.refreshUniverse.lastRefreshAt();

    const rejections = Array.from(this.candleBuilder.rejectionCounts())
      .map(([code, count]) => `${code}=${count}`)
      .join(',');

    const detail =
      `subscribed=${subscribed} ticks=${stats.ticks} orderbooks=${stats.orderbooks} ` +
      `marketIndexes=${stats.marketIndexes} ` +
      `openBuckets=${openBuckets} closedCandles=${this.candleClose.closedCount()} ` +
      `deadLetters=${stats.deadLetters} parseWarnings=${stats.parseWarnings} ` +
      `rejections=[${rejections}] ` +
      `lastTickAt=${last?.toISOString() ?? 'never'} lastObAt=${lastOb?.toISOString() ?? 'never'} ` +
      `lastCloseAt=${lastClose?.toISOString() ?? 'never'} ` +
      `universeSize=${universeSize} observedAdmin=${adminCount} observedFe=${feCount} ` +
      `universeRefreshOk=${this.refreshUniverse.lastRefreshOk()} ` +
      `lastUniverseRefreshAt=${lastRefresh?.toISOString() ?? 'never'} ` +
      `wsConnected=${this.subscriber.isConnected()} uptime=${Math.floor((Date.now() - this.bootedAt) / 1000)}s`;

    return {
      role: 'collector',
      ready: true,
      detail,
    };
  }
}
