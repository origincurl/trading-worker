import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BeControlPlaneModule } from '@external/be-control-plane/be-control-plane.module';
import { BrokerageModule } from '@external/brokerage/brokerage.module';
import { EXECUTOR_STATUS } from '@roles/role-status';
import { OrderAttemptEntity } from './repository/order-attempt.entity';
import { OrderFillEntity } from './repository/order-fill.entity';
import { ORDER_REPOSITORY, OrderRepositoryImpl } from './repository/order.repository';
import { ExecutorOrderService } from './service/executor-order.service';
import { ExecutorStatusService } from './service/executor-status.service';
import { SignalDetectedConsumer } from './trigger/consumer/signal-detected.consumer';
import { KiwoomExecutionSubscriber } from './trigger/subscriber/kiwoom-execution.subscriber';
import { IngestOrderFillUsecase } from './usecase/ingest-order-fill.usecase';
import { PlaceOrderUsecase } from './usecase/place-order.usecase';

// Vendor-dependent role. Uses EXECUTOR_BROKERAGE_GATEWAY token — distinct
// credentials from collector to keep the order rate-limit budget unshared
// (architecture.md §10).
@Module({
  imports: [
    BrokerageModule,
    BeControlPlaneModule,
    TypeOrmModule.forFeature([OrderAttemptEntity, OrderFillEntity]),
  ],
  providers: [
    ExecutorStatusService,
    ExecutorOrderService,
    OrderRepositoryImpl,
    { provide: ORDER_REPOSITORY, useExisting: OrderRepositoryImpl },
    PlaceOrderUsecase,
    IngestOrderFillUsecase,
    SignalDetectedConsumer,
    KiwoomExecutionSubscriber,
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
