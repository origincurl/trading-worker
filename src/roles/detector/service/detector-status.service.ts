import { Inject, Injectable } from '@nestjs/common';
import { NOTIFY_GATEWAY } from '@external/notify/notify.token';
import type { NotifyVendor } from '@external/notify/vendor/notify.vendor';
import type { RoleStatus, RoleStatusProvider } from '@roles/role-status';
import { EvaluateAlertsUsecase } from '@roles/detector/usecase/evaluate-alerts.usecase';
import { AlertService } from './alert.service';

@Injectable()
export class DetectorStatusService implements RoleStatusProvider {
  private readonly bootedAt = Date.now();

  constructor(
    @Inject(NOTIFY_GATEWAY) private readonly _notify: NotifyVendor,
    private readonly alertService: AlertService,
    private readonly evaluateUsecase: EvaluateAlertsUsecase,
  ) {
    void this._notify;
  }

  getStatus(): RoleStatus {
    const lastRaised = this.alertService.lastRaisedAt();
    const lastRun = this.evaluateUsecase.lastRunAt();

    return {
      role: 'detector',
      ready: true,
      detail:
        `alertsRaised=${this.alertService.raisedCount()} ` +
        `dedupSuppressed=${this.alertService.suppressedCount()} ` +
        `lastRaisedAt=${lastRaised?.toISOString() ?? 'never'} ` +
        `lastEvalAt=${lastRun?.toISOString() ?? 'never'} ` +
        `uptime=${Math.floor((Date.now() - this.bootedAt) / 1000)}s`,
    };
  }
}
