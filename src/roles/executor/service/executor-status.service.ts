import { Injectable } from '@nestjs/common';
import type { RoleStatus, RoleStatusProvider } from '@roles/role-status';
import { PlaceOrderUsecase } from '@roles/executor/usecase/place-order.usecase';

@Injectable()
export class ExecutorStatusService implements RoleStatusProvider {
  private readonly bootedAt = Date.now();

  constructor(private readonly placeOrder: PlaceOrderUsecase) {}

  getStatus(): RoleStatus {
    const lastSignal = this.placeOrder.lastSignalAt();

    return {
      role: 'executor',
      ready: true,
      detail:
        `signalsPlaced=${this.placeOrder.placedCount()} ` +
        `signalsRejected=${this.placeOrder.rejectedCount()} ` +
        `lastSignalAt=${lastSignal?.toISOString() ?? 'never'} ` +
        `uptime=${Math.floor((Date.now() - this.bootedAt) / 1000)}s`,
    };
  }
}
