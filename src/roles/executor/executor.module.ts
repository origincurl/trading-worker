import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrokerageModule } from '@external/brokerage/brokerage.module';
import { EXECUTOR_STATUS } from '@roles/role-status';
import { OrderAttemptEntity } from '@shared/persistence/order/order-attempt.entity';
import {
  ORDER_ATTEMPT_REPOSITORY,
  OrderAttemptRepositoryImpl,
} from '@shared/persistence/order/order-attempt.repository';
import { ExecutorOrderService } from './service/executor-order.service';
import { ExecutorStatusService } from './service/executor-status.service';
import { SignalDetectedConsumer } from './trigger/consumer/signal-detected.consumer';
import { OrderPickupScheduler } from './trigger/scheduler/order-pickup.scheduler';
import { PickupCancellingOrdersUsecase } from './usecase/pickup-cancelling-orders.usecase';
import { PickupRequestedOrdersUsecase } from './usecase/pickup-requested-orders.usecase';
import { PlaceOrderUsecase } from './usecase/place-order.usecase';

// Vendor-dependent role. Uses EXECUTOR_BROKERAGE_VENDOR token — distinct
// credentials from collector to keep the order rate-limit budget unshared
// (architecture.md §10). Execution-stream ingest moved to tracker per
// phase/06-worker-tracker.md §3: executor only places orders / records
// attempts; fills are owned by tracker.
@Module({
  imports: [BrokerageModule, TypeOrmModule.forFeature([OrderAttemptEntity])],
  providers: [
    ExecutorStatusService,
    ExecutorOrderService,
    OrderAttemptRepositoryImpl,
    { provide: ORDER_ATTEMPT_REPOSITORY, useExisting: OrderAttemptRepositoryImpl },
    PlaceOrderUsecase,
    PickupRequestedOrdersUsecase,
    PickupCancellingOrdersUsecase,
    OrderPickupScheduler,
    SignalDetectedConsumer,
    { provide: EXECUTOR_STATUS, useExisting: ExecutorStatusService },
  ],
  exports: [EXECUTOR_STATUS],
})
export class ExecutorModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExecutorModule.name);

  onApplicationBootstrap(): void {
    this.logger.log('executor role active');
  }
}
