import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrokerageModule } from '@external/brokerage/brokerage.module';
import { TRACKER_STATUS } from '@roles/role-status';
import {
  ORDER_FILL_REPOSITORY,
  OrderFillRepositoryImpl,
} from '@shared/persistence/order-fill/order-fill.repository';
import { OrderFillEntity } from '@shared/persistence/order-fill/order-fill.entity';
import { AccountBalanceEntity } from './repository/account-balance.entity';
import { ACCOUNT_BALANCE_REPOSITORY } from './repository/account-balance.repository';
import { AccountBalanceRepositoryImpl } from './repository/account-balance.repository.impl';
import { PositionEntity } from './repository/position.entity';
import { POSITION_REPOSITORY } from './repository/position.repository';
import { PositionRepositoryImpl } from './repository/position.repository.impl';
import { AccountBalanceService } from './service/account-balance.service';
import { AccountPositionService } from './service/account-position.service';
import { ExecutionService } from './service/execution.service';
import { TrackerStatusService } from './service/tracker-status.service';
import { TrackerTargetService } from './service/tracker-target.service';
import { AccountBalanceScheduler } from './trigger/scheduler/account-balance.scheduler';
import { AccountPositionScheduler } from './trigger/scheduler/account-position.scheduler';
import { HeartbeatScheduler } from './trigger/scheduler/heartbeat.scheduler';
import { KiwoomExecutionSubscriber } from './trigger/subscriber/kiwoom-execution.subscriber';
import { HeartbeatUsecase } from './usecase/heartbeat.usecase';
import { IngestExecutionUsecase } from './usecase/ingest-execution.usecase';
import { SyncAccountBalanceUsecase } from './usecase/sync-account-balance.usecase';
import { SyncAccountPositionUsecase } from './usecase/sync-account-position.usecase';

// Vendor-dependent role. Reuses EXECUTOR_BROKERAGE_VENDOR (account-scoped
// credential pool — phase/06-worker-tracker.md §4) so tracker shares the
// per-account rate budget with executor. Spec leaves room for renaming
// the token to ACCOUNT_BROKERAGE_GATEWAY in a later phase.
@Module({
  imports: [
    BrokerageModule,
    TypeOrmModule.forFeature([AccountBalanceEntity, PositionEntity, OrderFillEntity]),
  ],
  providers: [
    TrackerStatusService,
    TrackerTargetService,
    AccountBalanceService,
    AccountPositionService,
    ExecutionService,
    AccountBalanceRepositoryImpl,
    { provide: ACCOUNT_BALANCE_REPOSITORY, useExisting: AccountBalanceRepositoryImpl },
    PositionRepositoryImpl,
    { provide: POSITION_REPOSITORY, useExisting: PositionRepositoryImpl },
    OrderFillRepositoryImpl,
    { provide: ORDER_FILL_REPOSITORY, useExisting: OrderFillRepositoryImpl },
    SyncAccountBalanceUsecase,
    SyncAccountPositionUsecase,
    IngestExecutionUsecase,
    HeartbeatUsecase,
    KiwoomExecutionSubscriber,
    AccountBalanceScheduler,
    AccountPositionScheduler,
    HeartbeatScheduler,
    { provide: TRACKER_STATUS, useExisting: TrackerStatusService },
  ],
  exports: [TRACKER_STATUS],
})
export class TrackerModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(TrackerModule.name);

  onApplicationBootstrap(): void {
    this.logger.log('tracker role active');
  }
}
