import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CALCULATOR_METRICS, CALCULATOR_STATUS } from '@roles/role-status';
import { IndicatorEntity } from './repository/indicator.entity';
import { INDICATOR_REPOSITORY, IndicatorRepositoryImpl } from './repository/indicator.repository';
import { CalculatorStatusService } from './service/calculator-status.service';
import { IndicatorService } from './service/indicator.service';
import { MarketCandleConsumer } from './trigger/consumer/market-candle.consumer';
import { ProcessClosedCandleUsecase } from './usecase/process-closed-candle.usecase';

// Vendor-agnostic by design (architecture.md §3, §13). MUST NOT import
// BrokerageModule — eslint forbids @external/brokerage/* imports in
// calculator files at compile time; the module structure mirrors that.
@Module({
  imports: [TypeOrmModule.forFeature([IndicatorEntity])],
  providers: [
    CalculatorStatusService,
    IndicatorService,
    IndicatorRepositoryImpl,
    { provide: INDICATOR_REPOSITORY, useExisting: IndicatorRepositoryImpl },
    ProcessClosedCandleUsecase,
    MarketCandleConsumer,
    { provide: CALCULATOR_STATUS, useExisting: CalculatorStatusService },
    { provide: CALCULATOR_METRICS, useExisting: CalculatorStatusService },
  ],
  exports: [CALCULATOR_STATUS, CALCULATOR_METRICS],
})
export class CalculatorModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(CalculatorModule.name);

  onApplicationBootstrap(): void {
    this.logger.log('calculator role active');
  }
}
