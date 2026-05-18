import { Injectable, Logger } from '@nestjs/common';
import { HeartbeatWriter } from '@shared/cache/heartbeat.writer';
import { NotifierStatusService } from '@roles/notifier/service/notifier-status.service';

// Mirrors tracker/collector heartbeat: writes
// worker:heartbeat:notifier:{instanceId} via HeartbeatWriter (key built
// from runtime.workerInstanceId; role appears in the JSON value) and
// logs the current status detail for ops dashboards.
@Injectable()
export class HeartbeatUsecase {
  private readonly logger = new Logger(HeartbeatUsecase.name);

  constructor(
    private readonly status: NotifierStatusService,
    private readonly writer: HeartbeatWriter,
  ) {}

  async execute(): Promise<void> {
    await this.writer.tick();

    const status = this.status.getStatus();

    this.logger.log(`notifier heartbeat: ${status.detail ?? 'ready'}`);
  }
}
