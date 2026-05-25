import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrokerageModule } from '@external/brokerage/brokerage.module';
import { TRACKER_METRICS, TRACKER_STATUS } from '@roles/role-status';
import { OrderFillEntity } from '@shared/persistence/order-fill/order-fill.entity';
import { FillEntity } from '@shared/persistence/fill/fill.entity';
import { PositionBookEntity } from '@shared/persistence/position-book/position-book.entity';
import { UnmatchedOrderFillEntity } from '@shared/persistence/unmatched-order-fill/unmatched-order-fill.entity';
import { AccountBalanceEntity } from './repository/account-balance.entity';
import { ACCOUNT_BALANCE_REPOSITORY } from './repository/account-balance.repository';
import { AccountBalanceRepositoryImpl } from './repository/account-balance.repository.impl';
import { PositionEntity } from './repository/position.entity';
import { POSITION_REPOSITORY } from './repository/position.repository';
import { PositionRepositoryImpl } from './repository/position.repository.impl';
import { AccountBalanceService } from './service/account-balance.service';
import { AccountPositionService } from './service/account-position.service';
import {
  BROKER_STATUS_GATEWAY,
  NoopBrokerStatusGateway,
} from './service/broker-status.gateway';
import { ExecutionPersistenceService } from './service/execution-persistence.service';
import { ExecutionService } from './service/execution.service';
import { TrackerStatusService } from './service/tracker-status.service';
import { TrackerTargetService } from './service/tracker-target.service';
import { TrackerWsOwnershipService } from './service/tracker-ws-ownership.service';
import { AccountBalanceScheduler } from './trigger/scheduler/account-balance.scheduler';
import { AccountPositionScheduler } from './trigger/scheduler/account-position.scheduler';
import { BrokerReconciliationScheduler } from './trigger/scheduler/broker-reconciliation.scheduler';
import { FillMaintenanceScheduler } from './trigger/scheduler/fill-maintenance.scheduler';
import { StuckOrderMonitorScheduler } from './trigger/scheduler/stuck-order-monitor.scheduler';
import { KiwoomExecutionSubscriber } from './trigger/subscriber/kiwoom-execution.subscriber';
import { BrokerReconciliationUsecase } from './usecase/broker-reconciliation.usecase';
import { IngestExecutionUsecase } from './usecase/ingest-execution.usecase';
import { MonitorStuckOrdersUsecase } from './usecase/monitor-stuck-orders.usecase';
import { SyncAccountBalanceUsecase } from './usecase/sync-account-balance.usecase';
import { SyncAccountPositionUsecase } from './usecase/sync-account-position.usecase';

// Vendor-dependent role. Reuses EXECUTOR_BROKERAGE_VENDOR (account-scoped
// credential pool — phase/06-worker-tracker.md §4) so tracker shares the
// per-account rate budget with executor. Spec leaves room for renaming
// the token to ACCOUNT_BROKERAGE_GATEWAY in a later phase.
@Module({
  imports: [
    BrokerageModule,
    TypeOrmModule.forFeature([
      AccountBalanceEntity,
      PositionEntity,
      OrderFillEntity,
      FillEntity,
      UnmatchedOrderFillEntity,
      PositionBookEntity,
    ]),
  ],
  providers: [
    TrackerStatusService,
    TrackerTargetService,
    TrackerWsOwnershipService,
    NoopBrokerStatusGateway,
    { provide: BROKER_STATUS_GATEWAY, useExisting: NoopBrokerStatusGateway },
    AccountBalanceService,
    AccountPositionService,
    ExecutionPersistenceService,
    ExecutionService,
    AccountBalanceRepositoryImpl,
    { provide: ACCOUNT_BALANCE_REPOSITORY, useExisting: AccountBalanceRepositoryImpl },
    PositionRepositoryImpl,
    { provide: POSITION_REPOSITORY, useExisting: PositionRepositoryImpl },
    SyncAccountBalanceUsecase,
    SyncAccountPositionUsecase,
    BrokerReconciliationUsecase,
    IngestExecutionUsecase,
    MonitorStuckOrdersUsecase,
    KiwoomExecutionSubscriber,
    AccountBalanceScheduler,
    AccountPositionScheduler,
    BrokerReconciliationScheduler,
    FillMaintenanceScheduler,
    StuckOrderMonitorScheduler,
    { provide: TRACKER_STATUS, useExisting: TrackerStatusService },
    { provide: TRACKER_METRICS, useExisting: TrackerStatusService },
  ],
  exports: [TRACKER_STATUS, TRACKER_METRICS],
})
export class TrackerModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(TrackerModule.name);

  onApplicationBootstrap(): void {
    this.logger.log('tracker role active');
  }
}
