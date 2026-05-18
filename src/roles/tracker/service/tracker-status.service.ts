import { Injectable } from '@nestjs/common';
import { KiwoomExecutionSubscriber } from '@roles/tracker/trigger/subscriber/kiwoom-execution.subscriber';
import { IngestExecutionUsecase } from '@roles/tracker/usecase/ingest-execution.usecase';
import type { RoleStatus, RoleStatusProvider } from '@roles/role-status';
import { AccountBalanceService } from './account-balance.service';
import { AccountPositionService } from './account-position.service';

// Mirrors CollectorStatusService: surfaces poller heartbeat counters and
// execution-stream connection state so /health can spot a dead tracker
// without inspecting role internals. Target cardinality is no longer a
// static config — TrackerTargetService resolves it per-tick from DB.
@Injectable()
export class TrackerStatusService implements RoleStatusProvider {
  private readonly bootedAt = Date.now();

  constructor(
    private readonly subscriber: KiwoomExecutionSubscriber,
    private readonly balanceService: AccountBalanceService,
    private readonly positionService: AccountPositionService,
    private readonly ingestExecution: IngestExecutionUsecase,
  ) {}

  getStatus(): RoleStatus {
    const lastBalance = this.balanceService.lastSyncedAt();
    const lastPosition = this.positionService.lastSyncedAt();
    const lastFill = this.ingestExecution.lastFillAt();

    return {
      role: 'tracker',
      ready: true,
      detail:
        `balanceSyncs=${this.balanceService.syncCount()} ` +
        `balanceErrors=${this.balanceService.errorCount()} ` +
        `positionSyncs=${this.positionService.syncCount()} ` +
        `positionErrors=${this.positionService.errorCount()} ` +
        `fills=${this.ingestExecution.fillCount()} ` +
        `lastBalanceAt=${lastBalance?.toISOString() ?? 'never'} ` +
        `lastPositionAt=${lastPosition?.toISOString() ?? 'never'} ` +
        `lastFillAt=${lastFill?.toISOString() ?? 'never'} ` +
        `wsConnected=${this.subscriber.isConnected()} ` +
        `uptime=${Math.floor((Date.now() - this.bootedAt) / 1000)}s`,
    };
  }
}
