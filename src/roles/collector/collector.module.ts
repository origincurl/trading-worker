import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrokerageModule } from '@external/brokerage/brokerage.module';
import { COLLECTOR_METRICS, COLLECTOR_STATUS } from '@roles/role-status';
import { ChartArchiveAuditService } from './chart-archive/chart-archive-audit.service';
import { ChartArchiveAlertService } from './chart-archive/chart-archive-alert.service';
import { ChartArchiveManifestRepository } from './chart-archive/chart-archive-manifest.repository';
import { ChartArchiveRebuildSubscriber } from './chart-archive/chart-archive-rebuild.subscriber';
import { ChartArchiveS3Service } from './chart-archive/chart-archive-s3.service';
import { ChartArchiveScheduler } from './chart-archive/chart-archive.scheduler';
import { ChartArchiveTaskRepository } from './chart-archive/chart-archive-task.repository';
import { ChartArchiveWriterService } from './chart-archive/chart-archive-writer.service';
import { KrxCalendarSyncService } from './chart-archive/krx-calendar-sync.service';
import { KrxCalendarService } from './chart-archive/krx-calendar.service';
import { CandleEntity } from './repository/candle.entity';
import { CANDLE_REPOSITORY } from './repository/candle.repository';
import { CandleRepositoryImpl } from './repository/candle.repository.impl';
import { DeadLetterEntity } from './repository/dead-letter.entity';
import {
  DEAD_LETTER_REPOSITORY,
  DeadLetterRepositoryImpl,
} from './repository/dead-letter.repository';
import { CandleBuilderService } from './service/candle-builder.service';
import { CandleCloseService } from './service/candle-close.service';
import { ChartCatchupService } from './service/chart-catchup.service';
import { ChartEmptyRangeService } from './service/chart-empty-range.service';
import { CollectorShardAssignmentService } from './service/collector-shard-assignment.service';
import { CollectorStatusService } from './service/collector-status.service';
import { DeadLetterService } from './service/dead-letter.service';
import { FxSnapshotService } from './service/fx-snapshot.service';
import { MarketDashboardSnapshotService } from './service/market-dashboard-snapshot.service';
import { MarketIndexSnapshotService } from './service/market-index-snapshot.service';
import { MarketOrderbookService } from './service/market-orderbook.service';
import { HeldPositionDemandService } from './service/held-position-demand.service';
import { MarketTickService } from './service/market-tick.service';
import { StrategyDemandService } from './service/strategy-demand.service';
import { SubscriptionPlannerService } from './service/subscription-planner.service';
import { UniverseService } from './service/universe.service';
import { ChartCatchupConsumer } from './trigger/consumer/chart-catchup.consumer';
import { CandleFlushScheduler } from './trigger/scheduler/candle-flush.scheduler';
import { MarketSnapshotScheduler } from './trigger/scheduler/market-snapshot.scheduler';
import { StockListSyncScheduler } from './trigger/scheduler/stock-list-sync.scheduler';
import { UniverseRefreshScheduler } from './trigger/scheduler/universe-refresh.scheduler';
import { ChartCatchupRequestSubscriber } from './trigger/subscriber/chart-catchup-request.subscriber';
import { KiwoomTickSubscriber } from './trigger/subscriber/kiwoom-tick.subscriber';
import { UniverseRefreshHintSubscriber } from './trigger/subscriber/universe-refresh-hint.subscriber';
import { IngestTickUsecase } from './usecase/ingest-tick.usecase';
import { ProcessChartCatchupUsecase } from './usecase/process-chart-catchup.usecase';
import { RefreshUniverseUsecase } from './usecase/refresh-universe.usecase';
import { SyncStockListUsecase } from './usecase/sync-stock-list.usecase';

@Module({
  imports: [BrokerageModule, TypeOrmModule.forFeature([CandleEntity, DeadLetterEntity])],
  providers: [
    CollectorStatusService,
    MarketTickService,
    MarketOrderbookService,
    CandleBuilderService,
    CandleCloseService,
    ChartCatchupService,
    ChartEmptyRangeService,
    CollectorShardAssignmentService,
    DeadLetterService,
    MarketIndexSnapshotService,
    MarketDashboardSnapshotService,
    FxSnapshotService,
    HeldPositionDemandService,
    UniverseService,
    StrategyDemandService,
    SubscriptionPlannerService,
    KrxCalendarService,
    ChartArchiveAlertService,
    ChartArchiveAuditService,
    ChartArchiveS3Service,
    ChartArchiveManifestRepository,
    ChartArchiveRebuildSubscriber,
    ChartArchiveTaskRepository,
    ChartArchiveWriterService,
    KrxCalendarSyncService,
    CandleRepositoryImpl,
    DeadLetterRepositoryImpl,
    { provide: CANDLE_REPOSITORY, useExisting: CandleRepositoryImpl },
    { provide: DEAD_LETTER_REPOSITORY, useExisting: DeadLetterRepositoryImpl },
    IngestTickUsecase,
    RefreshUniverseUsecase,
    SyncStockListUsecase,
    ProcessChartCatchupUsecase,
    KiwoomTickSubscriber,
    ChartCatchupRequestSubscriber,
    UniverseRefreshHintSubscriber,
    ChartCatchupConsumer,
    MarketSnapshotScheduler,
    CandleFlushScheduler,
    UniverseRefreshScheduler,
    StockListSyncScheduler,
    ChartArchiveScheduler,
    { provide: COLLECTOR_STATUS, useExisting: CollectorStatusService },
    { provide: COLLECTOR_METRICS, useExisting: CollectorStatusService },
  ],
  exports: [COLLECTOR_STATUS, COLLECTOR_METRICS],
})
export class CollectorModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(CollectorModule.name);

  onApplicationBootstrap(): void {
    this.logger.log('collector role active');
  }
}
