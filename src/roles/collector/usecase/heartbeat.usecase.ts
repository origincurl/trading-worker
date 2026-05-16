import { Injectable, Logger } from '@nestjs/common';
import { CollectorStatusService } from '../service/collector-status.service';

// Phase 5 placeholder: a heartbeat that proves the collector wiring (trigger
// → usecase → service) is alive. Replaced by real ingestion usecases in
// Phase 6.
@Injectable()
export class HeartbeatUsecase {
  private readonly logger = new Logger(HeartbeatUsecase.name);

  constructor(private readonly status: CollectorStatusService) {}

  async execute(): Promise<void> {
    const status = this.status.getStatus();

    this.logger.log(`collector heartbeat: ${status.detail ?? 'ready'}`);
  }
}
