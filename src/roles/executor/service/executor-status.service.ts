import { Injectable } from '@nestjs/common';
import type { RoleStatus, RoleStatusProvider } from '@roles/role-status';
import { KiwoomExecutionSubscriber } from '@roles/executor/trigger/subscriber/kiwoom-execution.subscriber';
import { IngestOrderFillUsecase } from '@roles/executor/usecase/ingest-order-fill.usecase';
import { PlaceOrderUsecase } from '@roles/executor/usecase/place-order.usecase';

@Injectable()
export class ExecutorStatusService implements RoleStatusProvider {
  private readonly bootedAt = Date.now();

  constructor(
    private readonly subscriber: KiwoomExecutionSubscriber,
    private readonly placeOrder: PlaceOrderUsecase,
    private readonly ingestFill: IngestOrderFillUsecase,
  ) {}

  getStatus(): RoleStatus {
    const lastSignal = this.placeOrder.lastSignalAt();
    const lastFill = this.ingestFill.lastFillAt();

    return {
      role: 'executor',
      ready: true,
      detail:
        `signalsPlaced=${this.placeOrder.placedCount()} ` +
        `signalsRejected=${this.placeOrder.rejectedCount()} ` +
        `fills=${this.ingestFill.fillCount()} ` +
        `lastSignalAt=${lastSignal?.toISOString() ?? 'never'} ` +
        `lastFillAt=${lastFill?.toISOString() ?? 'never'} ` +
        `wsConnected=${this.subscriber.isConnected()} ` +
        `uptime=${Math.floor((Date.now() - this.bootedAt) / 1000)}s`,
    };
  }
}
