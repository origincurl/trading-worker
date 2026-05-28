import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

type TaskStatus = 'PENDING' | 'RUNNING' | 'READY' | 'FAILED' | 'SKIPPED';

export interface ChartArchiveTaskKey {
  runId: string;
  provider: string;
  marketEnv: 'mock' | 'production';
  symbol: string;
  timeframe: '1m' | '1h' | '1d';
  partitionKey: string;
}

@Injectable()
export class ChartArchiveTaskRepository {
  private readonly logger = new Logger(ChartArchiveTaskRepository.name);

  constructor(@Optional() @InjectDataSource() private readonly dataSource?: DataSource) {}

  async resetOrphanedRunningTasks(timeoutMinutes = 30): Promise<number> {
    if (!this.dataSource) return 0;
    const rows = (await this.dataSource.query(
      `
        UPDATE chart_archive_tasks
        SET status = 'PENDING',
            started_at = NULL,
            updated_at = NOW()
        WHERE status = 'RUNNING'
          AND started_at < NOW() - ($1::int * interval '1 minute')
        RETURNING id
      `,
      [timeoutMinutes],
    )) as Array<{ id: number }>;
    if (rows.length > 0) this.logger.warn(`reset ${rows.length} orphaned chart archive tasks`);
    return rows.length;
  }

  async findCarryoverSymbols(input: {
    provider: string;
    marketEnv: 'mock' | 'production';
    partitionKey: string;
  }): Promise<string[]> {
    if (!this.dataSource) return [];
    const rows = (await this.dataSource.query(
      `
        SELECT DISTINCT symbol
        FROM chart_archive_tasks
        WHERE provider = $1
          AND market_env = $2
          AND timeframe = '1m'
          AND partition_key <= $3
          AND status IN ('PENDING', 'FAILED')
        ORDER BY symbol ASC
        LIMIT 10000
      `,
      [input.provider, input.marketEnv, input.partitionKey],
    )) as Array<{ symbol: string }>;
    return rows.map((row) => row.symbol);
  }

  async findStrandedTradeDates(input: {
    provider: string;
    marketEnv: 'mock' | 'production';
    beforePartitionKey: string;
    limit?: number;
  }): Promise<string[]> {
    if (!this.dataSource) return [];
    const rows = (await this.dataSource.query(
      `
        SELECT DISTINCT partition_key AS "partitionKey"
        FROM chart_archive_tasks
        WHERE provider = $1
          AND market_env = $2
          AND timeframe = '1m'
          AND partition_key < $3
          AND status IN ('PENDING', 'FAILED')
        ORDER BY partition_key DESC
        LIMIT $4
      `,
      [input.provider, input.marketEnv, input.beforePartitionKey, input.limit ?? 7],
    )) as Array<{ partitionKey: string }>;
    return rows.map((row) => row.partitionKey);
  }

  async createPendingTasks(tasks: readonly ChartArchiveTaskKey[]): Promise<void> {
    if (!this.dataSource || tasks.length === 0) return;
    for (const task of tasks) {
      await this.dataSource.query(
        `
          INSERT INTO chart_archive_tasks (
            run_id, provider, market_env, symbol, timeframe, partition_key,
            status, attempts, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', 0, NOW(), NOW())
          ON CONFLICT (run_id, provider, market_env, symbol, timeframe, partition_key)
          DO NOTHING
        `,
        [
          task.runId,
          task.provider,
          task.marketEnv,
          task.symbol,
          task.timeframe,
          task.partitionKey,
        ],
      );
    }
  }

  async markRunning(task: ChartArchiveTaskKey, maxAttempts = 5): Promise<'RUNNING' | 'SKIPPED'> {
    if (!this.dataSource) return 'RUNNING';
    const rows = (await this.dataSource.query(
      `
        UPDATE chart_archive_tasks
        SET status = CASE WHEN attempts >= $7::int THEN 'SKIPPED' ELSE 'RUNNING' END,
            attempts = attempts + CASE WHEN attempts >= $7::int THEN 0 ELSE 1 END,
            started_at = CASE WHEN attempts >= $7::int THEN started_at ELSE NOW() END,
            finished_at = CASE WHEN attempts >= $7::int THEN NOW() ELSE finished_at END,
            error_message = CASE WHEN attempts >= $7::int THEN 'max attempts exceeded' ELSE NULL END,
            updated_at = NOW()
        WHERE run_id = $1
          AND provider = $2
          AND market_env = $3
          AND symbol = $4
          AND timeframe = $5
          AND partition_key = $6
        RETURNING status
      `,
      [
        task.runId,
        task.provider,
        task.marketEnv,
        task.symbol,
        task.timeframe,
        task.partitionKey,
        maxAttempts,
      ],
    )) as Array<{ status: 'RUNNING' | 'SKIPPED' }>;
    return rows[0]?.status ?? 'RUNNING';
  }

  async markReady(task: ChartArchiveTaskKey): Promise<void> {
    await this.updateTask(task, 'READY', null, false);
  }

  async markFailed(task: ChartArchiveTaskKey, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.updateTask(task, 'FAILED', message, false);
  }

  async markPending(task: ChartArchiveTaskKey, reason: string): Promise<void> {
    if (!this.dataSource) return;
    await this.dataSource.query(
      `
        UPDATE chart_archive_tasks
        SET status = 'PENDING',
            attempts = 0,
            started_at = NULL,
            finished_at = NULL,
            error_message = $7,
            updated_at = NOW()
        WHERE run_id = $1
          AND provider = $2
          AND market_env = $3
          AND symbol = $4
          AND timeframe = $5
          AND partition_key = $6
      `,
      [
        task.runId,
        task.provider,
        task.marketEnv,
        task.symbol,
        task.timeframe,
        task.partitionKey,
        reason,
      ],
    );
  }

  async retryFailedRun(runId: string, actor: string, reason: string | null): Promise<number> {
    if (!this.dataSource) return 0;
    const rows = (await this.dataSource.query(
      `
        UPDATE chart_archive_tasks
        SET status = 'PENDING',
            attempts = 0,
            started_at = NULL,
            finished_at = NULL,
            error_message = NULL,
            updated_at = NOW()
        WHERE run_id = $1
          AND status IN ('FAILED', 'SKIPPED')
        RETURNING id, status
      `,
      [runId],
    )) as Array<{ id: number; status: string }>;
    await this.audit({
      runId,
      action: 'retry_failed',
      actor,
      reason,
      newStatus: 'PENDING',
      metadata: { count: rows.length },
    });
    return rows.length;
  }

  async markSupersededStranded(input: {
    provider: string;
    marketEnv: 'mock' | 'production';
    partitionKey: string;
    supersededByRunId: string;
  }): Promise<number> {
    if (!this.dataSource) return 0;
    const rows = (await this.dataSource.query(
      `
        UPDATE chart_archive_tasks
        SET status = 'SKIPPED',
            finished_at = NOW(),
            error_message = $5,
            updated_at = NOW()
        WHERE provider = $1
          AND market_env = $2
          AND timeframe = '1m'
          AND partition_key = $3
          AND run_id <> $4
          AND status IN ('PENDING', 'FAILED')
        RETURNING id
      `,
      [
        input.provider,
        input.marketEnv,
        input.partitionKey,
        input.supersededByRunId,
        `superseded by recovery run ${input.supersededByRunId}`,
      ],
    )) as Array<{ id: number }>;
    if (rows.length > 0) {
      await this.audit({
        runId: input.supersededByRunId,
        action: 'supersede_stranded',
        actor: 'chart-archive-recovery',
        newStatus: 'SKIPPED',
        reason: `superseded stranded ${input.marketEnv}/${input.partitionKey}`,
        metadata: { count: rows.length, partitionKey: input.partitionKey },
      });
    }
    return rows.length;
  }

  async cleanupTerminalTasks(olderThanDays = 30): Promise<number> {
    if (!this.dataSource) return 0;
    const safeOlderThanDays = Math.max(7, Math.floor(olderThanDays));
    const rows = (await this.dataSource.query(
      `
        DELETE FROM chart_archive_tasks
        WHERE status IN ('READY', 'FAILED', 'SKIPPED')
          AND updated_at < NOW() - ($1::int * interval '1 day')
        RETURNING id
      `,
      [safeOlderThanDays],
    )) as Array<{ id: number }>;
    await this.audit({
      action: 'cleanup',
      actor: 'admin',
      reason: `cleanup terminal tasks older than ${safeOlderThanDays} days`,
      metadata: { olderThanDays: safeOlderThanDays, count: rows.length },
    });
    return rows.length;
  }

  private async audit(input: {
    runId?: string | null;
    taskId?: number | null;
    manifestId?: number | null;
    action: string;
    actor?: string | null;
    prevStatus?: string | null;
    newStatus?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    if (!this.dataSource) return;
    await this.dataSource.query(
      `
        INSERT INTO chart_archive_task_audits (
          run_id, task_id, manifest_id, action, actor, prev_status, new_status, reason, metadata_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        input.runId ?? null,
        input.taskId ?? null,
        input.manifestId ?? null,
        input.action,
        input.actor ?? null,
        input.prevStatus ?? null,
        input.newStatus ?? null,
        input.reason ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
  }

  private async updateTask(
    task: ChartArchiveTaskKey,
    status: TaskStatus,
    errorMessage: string | null,
    incrementAttempts: boolean,
  ): Promise<void> {
    if (!this.dataSource) return;
    await this.dataSource.query(
      `
        UPDATE chart_archive_tasks
        SET status = $7::varchar,
            attempts = attempts + CASE WHEN $8::boolean THEN 1 ELSE 0 END,
            started_at = CASE WHEN $7::varchar = 'RUNNING' THEN NOW() ELSE started_at END,
            finished_at = CASE WHEN $7::varchar IN ('READY', 'FAILED') THEN NOW() ELSE finished_at END,
            error_message = $9,
            updated_at = NOW()
        WHERE run_id = $1
          AND provider = $2
          AND market_env = $3
          AND symbol = $4
          AND timeframe = $5
          AND partition_key = $6
      `,
      [
        task.runId,
        task.provider,
        task.marketEnv,
        task.symbol,
        task.timeframe,
        task.partitionKey,
        status,
        incrementAttempts,
        errorMessage,
      ],
    );
  }
}
