import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotifyModule } from '@external/notify/notify.module';
import { DETECTOR_METRICS, DETECTOR_STATUS } from '@roles/role-status';
import { AlertRaisedEntity } from './repository/alert-raised.entity';
import { ALERT_REPOSITORY, AlertRepositoryImpl } from './repository/alert.repository';
import { AlertEvaluator } from './service/alert-evaluator.service';
import { AlertService } from './service/alert.service';
import { DetectorStatusService } from './service/detector-status.service';
import { AlertEvalScheduler } from './trigger/scheduler/alert-eval.scheduler';
import { EvaluateAlertsUsecase } from './usecase/evaluate-alerts.usecase';

// Vendor-agnostic by design. MUST NOT import BrokerageModule — alerts are
// generated from indicators + collector/executor DB rows, not market data
// flow. ScheduleModule.forRoot() lives in AppModule (single root) so
// @Interval handlers don't double-fire when multiple role modules load.
@Module({
  imports: [NotifyModule, TypeOrmModule.forFeature([AlertRaisedEntity])],
  providers: [
    DetectorStatusService,
    AlertService,
    AlertEvaluator,
    AlertRepositoryImpl,
    { provide: ALERT_REPOSITORY, useExisting: AlertRepositoryImpl },
    EvaluateAlertsUsecase,
    AlertEvalScheduler,
    { provide: DETECTOR_STATUS, useExisting: DetectorStatusService },
    { provide: DETECTOR_METRICS, useExisting: DetectorStatusService },
  ],
  exports: [DETECTOR_STATUS, DETECTOR_METRICS],
})
export class DetectorModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(DetectorModule.name);

  onApplicationBootstrap(): void {
    this.logger.log('detector role active');
  }
}
