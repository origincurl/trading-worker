import { Injectable } from '@nestjs/common';
import { AccountPositionService } from '@roles/tracker/service/account-position.service';
import { TrackerTargetService } from '@roles/tracker/service/tracker-target.service';

@Injectable()
export class SyncAccountPositionUsecase {
  constructor(
    private readonly targets: TrackerTargetService,
    private readonly positionService: AccountPositionService,
  ) {}

  async execute(): Promise<void> {
    const targets = await this.targets.shardedTargets();

    for (const target of targets) {
      await this.positionService.syncOne(target);
    }
  }
}
