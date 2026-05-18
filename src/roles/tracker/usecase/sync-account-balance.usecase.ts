import { Injectable } from '@nestjs/common';
import { AccountBalanceService } from '@roles/tracker/service/account-balance.service';
import { TrackerTargetService } from '@roles/tracker/service/tracker-target.service';

@Injectable()
export class SyncAccountBalanceUsecase {
  constructor(
    private readonly targets: TrackerTargetService,
    private readonly balanceService: AccountBalanceService,
  ) {}

  async execute(): Promise<void> {
    const targets = await this.targets.shardedTargets();

    // Sequential per-target — keeps vendor rate-limit budgets predictable
    // and matches the executor's existing one-call-at-a-time discipline
    // until Phase 9 batches by brokerage.
    for (const target of targets) {
      await this.balanceService.syncOne(target);
    }
  }
}
