import { Injectable } from '@nestjs/common';
import type { RoleMetricProvider, RoleStatus, RoleStatusProvider } from '@roles/role-status';
import { ProcessClosedCandleUsecase } from '@roles/calculator/usecase/process-closed-candle.usecase';

@Injectable()
export class CalculatorStatusService implements RoleStatusProvider, RoleMetricProvider {
  private readonly bootedAt = Date.now();

  constructor(private readonly usecase: ProcessClosedCandleUsecase) {}

  getRoleMetrics() {
    return {
      role: 'calculator' as const,
      metrics: {
        processed_closed_candles: this.usecase.processedCount(),
        last_processed_at: this.usecase.lastProcessedAt()?.toISOString() ?? null,
      },
    };
  }

  getStatus(): RoleStatus {
    const last = this.usecase.lastProcessedAt();

    return {
      role: 'calculator',
      ready: true,
      detail:
        `processed=${this.usecase.processedCount()} ` +
        `lastProcessedAt=${last?.toISOString() ?? 'never'} ` +
        `uptime=${Math.floor((Date.now() - this.bootedAt) / 1000)}s`,
    };
  }
}
