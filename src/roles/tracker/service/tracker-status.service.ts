import { Injectable } from '@nestjs/common';
import { KiwoomExecutionSubscriber } from '@roles/tracker/trigger/subscriber/kiwoom-execution.subscriber';
import { IngestExecutionUsecase } from '@roles/tracker/usecase/ingest-execution.usecase';
import type { RoleMetricProvider, RoleStatus, RoleStatusProvider } from '@roles/role-status';
import { AccountBalanceService } from './account-balance.service';
import { AccountPositionService } from './account-position.service';
import { TrackerWsOwnershipService } from './tracker-ws-ownership.service';

// Mirrors CollectorStatusService: surfaces poller heartbeat counters and
// execution-stream connection state so /health can spot a dead tracker
// without inspecting role internals. Target cardinality is no longer a
// static config — TrackerTargetService resolves it per-tick from DB.
@Injectable()
export class TrackerStatusService implements RoleStatusProvider, RoleMetricProvider {
  private readonly bootedAt = Date.now();

  constructor(
    private readonly subscriber: KiwoomExecutionSubscriber,
    private readonly balanceService: AccountBalanceService,
    private readonly positionService: AccountPositionService,
    private readonly ingestExecution: IngestExecutionUsecase,
    private readonly wsOwnership: TrackerWsOwnershipService,
  ) {}

  getRoleMetrics() {
    const leases = this.wsOwnership.snapshot();
    const owned = this.wsOwnership.ownedCredentialIds();

    return {
      role: 'tracker' as const,
      metrics: {
        balance_syncs: this.balanceService.syncCount(),
        balance_errors: this.balanceService.errorCount(),
        position_syncs: this.positionService.syncCount(),
        position_errors: this.positionService.errorCount(),
        fills: this.ingestExecution.fillCount(),
        last_balance_at: this.balanceService.lastSyncedAt()?.toISOString() ?? null,
        last_position_at: this.positionService.lastSyncedAt()?.toISOString() ?? null,
        last_fill_at: this.ingestExecution.lastFillAt()?.toISOString() ?? null,
        ws_connected: this.subscriber.isConnected(),
        ws_lease_candidates: leases.length,
        ws_lease_owned: owned.length,
        ws_lease_owned_credentials: owned.join(','),
      },
    };
  }

  getStatus(): RoleStatus {
    const lastBalance = this.balanceService.lastSyncedAt();
    const lastPosition = this.positionService.lastSyncedAt();
    const lastFill = this.ingestExecution.lastFillAt();
    const owned = this.wsOwnership.ownedCredentialIds();

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
        `wsLeaseOwned=${owned.length} ` +
        `uptime=${Math.floor((Date.now() - this.bootedAt) / 1000)}s`,
    };
  }
}
