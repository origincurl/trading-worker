import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EvaluateAlertsUsecase } from '@roles/detector/usecase/evaluate-alerts.usecase';

const EVAL_INTERVAL_MS = 60_000;

@Injectable()
export class AlertEvalScheduler {
  private readonly logger = new Logger(AlertEvalScheduler.name);

  constructor(private readonly usecase: EvaluateAlertsUsecase) {}

  @Interval('detector.alert-eval', EVAL_INTERVAL_MS)
  async tick(): Promise<void> {
    try {
      await this.usecase.execute();
    } catch (err) {
      this.logger.warn(`alert eval failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
