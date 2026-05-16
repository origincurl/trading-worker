import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BeControlPlaneModule } from '@external/be-control-plane/be-control-plane.module';
import { NotifyModule } from '@external/notify/notify.module';
import { DETECTOR_STATUS } from '@roles/role-status';
import { AlertRaisedEntity } from './repository/alert-raised.entity';
import { ALERT_REPOSITORY, AlertRepositoryImpl } from './repository/alert.repository';
import { AlertEvaluator } from './service/alert-evaluator.service';
import { AlertService } from './service/alert.service';
import { DetectorStatusService } from './service/detector-status.service';
import { AlertEvalScheduler } from './trigger/scheduler/alert-eval.scheduler';
import { EvaluateAlertsUsecase } from './usecase/evaluate-alerts.usecase';

// Vendor-agnostic by design. MUST NOT import BrokerageModule — alerts are
// generated from indicators + collector/executor DB rows, not market data
// flow. ScheduleModule.forRoot() is colocated so a `ROLES=collector`
// deploy doesn't pull a duplicate scheduler registry through this module.
@Module({
  imports: [
    ScheduleModule.forRoot(),
    NotifyModule,
    BeControlPlaneModule,
    TypeOrmModule.forFeature([AlertRaisedEntity]),
  ],
  providers: [
    DetectorStatusService,
    AlertService,
    AlertEvaluator,
    AlertRepositoryImpl,
    { provide: ALERT_REPOSITORY, useExisting: AlertRepositoryImpl },
    EvaluateAlertsUsecase,
    AlertEvalScheduler,
    { provide: DETECTOR_STATUS, useExisting: DetectorStatusService },
  ],
  exports: [DETECTOR_STATUS],
})
export class DetectorModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(DetectorModule.name);

  onApplicationBootstrap(): void {
    this.logger.log('detector role active');
  }
}
