import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BeControlPlaneModule } from '@external/be-control-plane/be-control-plane.module';
import { BrokerageModule } from '@external/brokerage/brokerage.module';
import { COLLECTOR_STATUS } from '@roles/role-status';
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
import { CollectorStatusService } from './service/collector-status.service';
import { DeadLetterService } from './service/dead-letter.service';
import { MarketOrderbookService } from './service/market-orderbook.service';
import { MarketTickService } from './service/market-tick.service';
import { SubscriptionPlannerService } from './service/subscription-planner.service';
import { UniverseService } from './service/universe.service';
import { CandleFlushScheduler } from './trigger/scheduler/candle-flush.scheduler';
import { ChartBackfillScheduler } from './trigger/scheduler/chart-backfill.scheduler';
import { HeartbeatScheduler } from './trigger/scheduler/heartbeat.scheduler';
import { UniverseRefreshScheduler } from './trigger/scheduler/universe-refresh.scheduler';
import { KiwoomTickSubscriber } from './trigger/subscriber/kiwoom-tick.subscriber';
import { HeartbeatUsecase } from './usecase/heartbeat.usecase';
import { IngestTickUsecase } from './usecase/ingest-tick.usecase';
import { ProcessChartBackfillLeaseUsecase } from './usecase/process-chart-backfill-lease.usecase';
import { RefreshUniverseUsecase } from './usecase/refresh-universe.usecase';

@Module({
  imports: [
    BrokerageModule,
    BeControlPlaneModule,
    TypeOrmModule.forFeature([CandleEntity, DeadLetterEntity]),
  ],
  providers: [
    CollectorStatusService,
    MarketTickService,
    MarketOrderbookService,
    CandleBuilderService,
    CandleCloseService,
    DeadLetterService,
    UniverseService,
    SubscriptionPlannerService,
    CandleRepositoryImpl,
    DeadLetterRepositoryImpl,
    { provide: CANDLE_REPOSITORY, useExisting: CandleRepositoryImpl },
    { provide: DEAD_LETTER_REPOSITORY, useExisting: DeadLetterRepositoryImpl },
    IngestTickUsecase,
    RefreshUniverseUsecase,
    ProcessChartBackfillLeaseUsecase,
    KiwoomTickSubscriber,
    HeartbeatUsecase,
    HeartbeatScheduler,
    CandleFlushScheduler,
    UniverseRefreshScheduler,
    ChartBackfillScheduler,
    { provide: COLLECTOR_STATUS, useExisting: CollectorStatusService },
  ],
  exports: [COLLECTOR_STATUS],
})
export class CollectorModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(CollectorModule.name);

  onApplicationBootstrap(): void {
    this.logger.log('collector role active');
  }
}
