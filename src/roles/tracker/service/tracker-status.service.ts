import { Injectable } from '@nestjs/common';
import { KiwoomExecutionSubscriber } from '@roles/tracker/trigger/subscriber/kiwoom-execution.subscriber';
import { IngestExecutionUsecase } from '@roles/tracker/usecase/ingest-execution.usecase';
import { BrokerReconciliationUsecase } from '@roles/tracker/usecase/broker-reconciliation.usecase';
import { MonitorStuckOrdersUsecase } from '@roles/tracker/usecase/monitor-stuck-orders.usecase';
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
    private readonly brokerReconciliation: BrokerReconciliationUsecase,
    private readonly stuckOrders: MonitorStuckOrdersUsecase,
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
        terminal_fill_anomalies: this.ingestExecution.terminalFillAnomalyCount(),
        unmatched_fill_retry_attempts: this.ingestExecution.unmatchedRetryAttempts(),
        unmatched_fills_resolved: this.ingestExecution.unmatchedResolvedCount(),
        unmatched_fills_dead_lettered: this.ingestExecution.unmatchedDeadLetterCount(),
        pending_unmatched_fills: this.ingestExecution.pendingUnmatchedCount(),
        dead_letter_fills: this.ingestExecution.deadLetterFillCount(),
        pending_fill_outbox: this.ingestExecution.pendingOutboxCount(),
        fill_outbox_permanent_failures:
          this.ingestExecution.outboxPermanentFailureCount(),
        fill_outbox_publish_attempts: this.ingestExecution.outboxPublishAttempts(),
        fill_outbox_publish_failures: this.ingestExecution.outboxPublishFailures(),
        broker_reconciliation_dry_run_orders: this.brokerReconciliation.lastDryRunCount(),
        kill_switch_reconciliation_candidates:
          this.brokerReconciliation.lastKillSwitchCancelCount(),
        broker_status_missing: this.brokerReconciliation.lastBrokerStatusMissingCount(),
        broker_status_diffs: this.brokerReconciliation.lastBrokerStatusDiffCount(),
        broker_quantity_diffs: this.brokerReconciliation.lastBrokerQuantityDiffCount(),
        stuck_orders: this.stuckOrders.lastStuckCount(),
        accepted_stale_orders: this.stuckOrders.lastAcceptedStaleCount(),
        last_balance_at: this.balanceService.lastSyncedAt()?.toISOString() ?? null,
        last_position_at: this.positionService.lastSyncedAt()?.toISOString() ?? null,
        last_fill_at: this.ingestExecution.lastFillAt()?.toISOString() ?? null,
        last_terminal_fill_anomaly_at:
          this.ingestExecution.lastTerminalFillAnomalyAt()?.toISOString() ?? null,
        last_broker_reconciliation_at:
          this.brokerReconciliation.lastScanAt()?.toISOString() ?? null,
        last_stuck_scan_at: this.stuckOrders.lastScanAt()?.toISOString() ?? null,
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
    const lastTerminalFillAnomaly = this.ingestExecution.lastTerminalFillAnomalyAt();
    const lastBrokerReconciliation = this.brokerReconciliation.lastScanAt();
    const lastStuckScan = this.stuckOrders.lastScanAt();
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
        `terminalFillAnomalies=${this.ingestExecution.terminalFillAnomalyCount()} ` +
        `pendingUnmatchedFills=${this.ingestExecution.pendingUnmatchedCount()} ` +
        `deadLetterFills=${this.ingestExecution.deadLetterFillCount()} ` +
        `pendingFillOutbox=${this.ingestExecution.pendingOutboxCount()} ` +
        `fillOutboxPermanentFailures=${this.ingestExecution.outboxPermanentFailureCount()} ` +
        `brokerReconciliationDryRunOrders=${this.brokerReconciliation.lastDryRunCount()} ` +
        `killSwitchReconciliationCandidates=${this.brokerReconciliation.lastKillSwitchCancelCount()} ` +
        `brokerStatusMissing=${this.brokerReconciliation.lastBrokerStatusMissingCount()} ` +
        `brokerStatusDiffs=${this.brokerReconciliation.lastBrokerStatusDiffCount()} ` +
        `brokerQuantityDiffs=${this.brokerReconciliation.lastBrokerQuantityDiffCount()} ` +
        `stuckOrders=${this.stuckOrders.lastStuckCount()} ` +
        `acceptedStaleOrders=${this.stuckOrders.lastAcceptedStaleCount()} ` +
        `lastBalanceAt=${lastBalance?.toISOString() ?? 'never'} ` +
        `lastPositionAt=${lastPosition?.toISOString() ?? 'never'} ` +
        `lastFillAt=${lastFill?.toISOString() ?? 'never'} ` +
        `lastTerminalFillAnomalyAt=${lastTerminalFillAnomaly?.toISOString() ?? 'never'} ` +
        `lastBrokerReconciliationAt=${lastBrokerReconciliation?.toISOString() ?? 'never'} ` +
        `lastStuckScanAt=${lastStuckScan?.toISOString() ?? 'never'} ` +
        `wsConnected=${this.subscriber.isConnected()} ` +
        `wsLeaseOwned=${owned.length} ` +
        `uptime=${Math.floor((Date.now() - this.bootedAt) / 1000)}s`,
    };
  }
}
