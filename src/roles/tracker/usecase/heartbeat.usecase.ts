import { Injectable, Logger } from '@nestjs/common';
import { HeartbeatWriter } from '@shared/cache/heartbeat.writer';
import { TrackerStatusService } from '@roles/tracker/service/tracker-status.service';

// Mirrors collector's heartbeat usecase: writes the role-keyed heartbeat
// key (worker:heartbeat:tracker:{instanceId} via HeartbeatWriter) and
// logs status detail at log level. /health pulls the in-memory status
// independently; this is the redis-visible signal for ops dashboards.
@Injectable()
export class HeartbeatUsecase {
  private readonly logger = new Logger(HeartbeatUsecase.name);

  constructor(
    private readonly status: TrackerStatusService,
    private readonly writer: HeartbeatWriter,
  ) {}

  async execute(): Promise<void> {
    await this.writer.tick();

    const status = this.status.getStatus();

    this.logger.log(`tracker heartbeat: ${status.detail ?? 'ready'}`);
  }
}
