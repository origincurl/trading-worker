import { forwardRef, Inject, Injectable } from '@nestjs/common';
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

  getStatus(): RoleStatus {
    const subscribed = this.subscriber.subscribedSymbols().length;
    const last = this.tickService.lastTickAt();
    const lastOb = this.orderbookService.lastSnapshotAt();
    const lastClose = this.candleClose.lastClosedAt();
    const stats = this.ingestUsecase.snapshotStats();
    const openBuckets = this.candleBuilder.openBuckets().length;
    const snap = this.universe.currentSnapshot();
    const lastRefresh = this.refreshUniverse.lastRefreshAt();

    const rejections = Array.from(this.candleBuilder.rejectionCounts())
      .map(([code, count]) => `${code}=${count}`)
      .join(',');

    const detail =
      `subscribed=${subscribed} ticks=${stats.ticks} orderbooks=${stats.orderbooks} ` +
      `openBuckets=${openBuckets} closedCandles=${this.candleClose.closedCount()} ` +
      `deadLetters=${stats.deadLetters} parseWarnings=${stats.parseWarnings} ` +
      `rejections=[${rejections}] ` +
      `lastTickAt=${last?.toISOString() ?? 'never'} lastObAt=${lastOb?.toISOString() ?? 'never'} ` +
      `lastCloseAt=${lastClose?.toISOString() ?? 'never'} ` +
      `universeV=${snap?.version ?? 'none'} universeSymbols=${snap?.symbols.length ?? 0} ` +
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
