import { Injectable, Logger } from '@nestjs/common';
import { AlertEvaluator } from '@roles/detector/service/alert-evaluator.service';
import { AlertService } from '@roles/detector/service/alert.service';

@Injectable()
export class EvaluateAlertsUsecase {
  private readonly logger = new Logger(EvaluateAlertsUsecase.name);

  private _lastRunAt: Date | null = null;

  constructor(
    private readonly evaluator: AlertEvaluator,
    private readonly alertService: AlertService,
  ) {}

  lastRunAt(): Date | null {
    return this._lastRunAt;
  }

  async execute(): Promise<void> {
    this._lastRunAt = new Date();

    const candidates = await this.evaluator.evaluate();

    for (const c of candidates) {
      try {
        await this.alertService.raise(c);
      } catch (err) {
        this.logger.warn(
          `alert raise failed (${c.category}): ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
}
