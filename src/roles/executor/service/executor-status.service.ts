import { Injectable } from '@nestjs/common';
import type { RoleMetricProvider, RoleStatus, RoleStatusProvider } from '@roles/role-status';
import { PlaceOrderUsecase } from '@roles/executor/usecase/place-order.usecase';

@Injectable()
export class ExecutorStatusService implements RoleStatusProvider, RoleMetricProvider {
  private readonly bootedAt = Date.now();

  constructor(private readonly placeOrder: PlaceOrderUsecase) {}

  getRoleMetrics() {
    return {
      role: 'executor' as const,
      metrics: {
        strategy_orders_accepted: this.placeOrder.placedCount(),
        strategy_orders_rejected: this.placeOrder.rejectedCount(),
        last_signal_at: this.placeOrder.lastSignalAt()?.toISOString() ?? null,
      },
    };
  }

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
