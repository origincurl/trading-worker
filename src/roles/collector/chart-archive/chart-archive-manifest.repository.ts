import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.tokens';
import type { ChartArchiveManifestRecord, ChartArchiveTimeframe } from '@shared/chart-archive/chart-archive.types';
import { partitionKeyFromBucket } from '@shared/chart-archive/partition-key';

@Injectable()
export class ChartArchiveManifestRepository {
  private readonly logger = new Logger(ChartArchiveManifestRepository.name);

  constructor(
    @Optional() @InjectDataSource() private readonly dataSource?: DataSource,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: RedisClientToken,
  ) {}

  async upsertManifest(input: ChartArchiveManifestRecord): Promise<ChartArchiveManifestRecord> {
    if (!this.dataSource) return input;
    const rows = (await this.dataSource.query(
      `
        INSERT INTO chart_archive_manifests (
          provider, market_env, market, symbol, stock_id, timeframe, partition_key,
          status, s3_key, sidecar_s3_key, expected_row_count, actual_row_count,
          coverage_ratio, object_checksum, content_checksum, source_checksum,
          source_run_id, schema_version, data_revision, archived_at,
          last_modified_at, error_message
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13, $14, $15, $16,
          $17, $18, 1, $19,
          $20, $21
        )
        ON CONFLICT (provider, market_env, symbol, timeframe, partition_key)
        DO UPDATE SET
          market = EXCLUDED.market,
          stock_id = EXCLUDED.stock_id,
          status = EXCLUDED.status,
          s3_key = EXCLUDED.s3_key,
          sidecar_s3_key = EXCLUDED.sidecar_s3_key,
          expected_row_count = GREATEST(chart_archive_manifests.expected_row_count, EXCLUDED.expected_row_count),
          actual_row_count = EXCLUDED.actual_row_count,
          coverage_ratio = CASE
            WHEN GREATEST(chart_archive_manifests.expected_row_count, EXCLUDED.expected_row_count) = 0 THEN 1.0
            ELSE EXCLUDED.actual_row_count::double precision /
              GREATEST(chart_archive_manifests.expected_row_count, EXCLUDED.expected_row_count)::double precision
          END,
          object_checksum = EXCLUDED.object_checksum,
          content_checksum = EXCLUDED.content_checksum,
          source_checksum = EXCLUDED.source_checksum,
          source_run_id = EXCLUDED.source_run_id,
          schema_version = EXCLUDED.schema_version,
          data_revision = chart_archive_manifests.data_revision + 1,
          archived_at = EXCLUDED.archived_at,
          last_modified_at = EXCLUDED.last_modified_at,
          error_message = EXCLUDED.error_message
        RETURNING id, data_revision AS "dataRevision"
      `,
      [
        input.provider,
        input.marketEnv,
        input.market,
        input.symbol,
        input.stockId,
        input.timeframe,
        input.partitionKey,
        input.status,
        input.s3Key,
        input.sidecarS3Key,
        input.expectedRowCount,
        input.actualRowCount,
        input.coverageRatio,
        input.objectChecksum,
        input.contentChecksum,
        input.sourceChecksum,
        input.sourceRunId,
        input.schemaVersion,
        new Date(input.archivedAt),
        new Date(input.lastModifiedAt),
        input.errorMessage ?? null,
      ],
    )) as Array<{ id: number; dataRevision: number }>;
    return { ...input, id: rows[0]?.id, dataRevision: rows[0]?.dataRevision ?? input.dataRevision };
  }

  async markDerivedStale(input: {
    provider: string;
    marketEnv: 'mock' | 'production';
    symbol: string;
    changedTradeDate: string;
  }): Promise<void> {
    if (!this.dataSource) return;
    const monthKey = partitionKeyFromBucket('1h', `${input.changedTradeDate}T00:00:00.000Z`, input.changedTradeDate);
    const yearKey = partitionKeyFromBucket('1d', `${input.changedTradeDate}T00:00:00.000Z`, input.changedTradeDate);
    await this.dataSource.query(
      `
        UPDATE chart_archive_manifests
        SET status = 'STALE',
            data_revision = data_revision + 1,
            last_modified_at = NOW()
        WHERE provider = $1
          AND market_env = $2
          AND symbol = $3
          AND ((timeframe = '1h' AND partition_key = $4) OR (timeframe = '1d' AND partition_key = $5))
          AND status = 'READY'
      `,
      [input.provider, input.marketEnv, input.symbol, monthKey, yearKey],
    ).catch((err) => {
      this.logger.warn(`failed to mark derived manifests STALE: ${err instanceof Error ? err.message : err}`);
    });
  }

  async publishManifestChanged(input: {
    provider: string;
    marketEnv: 'mock' | 'production';
    symbol: string;
    timeframe: ChartArchiveTimeframe;
    partitionKey: string;
    status?: string;
    dataRevision?: number;
    archivedAt?: string;
  }): Promise<void> {
    if (!this.redis) return;
    const channel = `chart_archive:manifest_changed:${input.provider}:${input.marketEnv}:${input.symbol}:${input.timeframe}:${input.partitionKey}`;
    await this.redis
      .publish(
        channel,
        JSON.stringify({
          status: input.status,
          dataRevision: input.dataRevision,
          archivedAt: input.archivedAt,
        }),
      )
      .catch((err) => {
        this.logger.warn(`manifest changed publish failed: ${err instanceof Error ? err.message : err}`);
      });
  }

  async latestMetrics(): Promise<Record<string, unknown>> {
    if (!this.dataSource) return {};
    const rows = (await this.dataSource.query(
      `
        SELECT
          MAX(archived_at)::text AS last_run_at,
          COUNT(*) FILTER (WHERE status = 'READY')::int AS ready_count,
          COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed_count,
          COUNT(*) FILTER (WHERE status = 'PARTIAL')::int AS partial_count,
          COUNT(*) FILTER (WHERE status = 'MISMATCH')::int AS mismatch_count,
          COUNT(*) FILTER (WHERE status = 'STALE')::int AS stale_count
        FROM chart_archive_manifests
        WHERE archived_at > NOW() - interval '36 hours'
      `,
    )) as Array<Record<string, unknown>>;
    return rows[0] ?? {};
  }

  async isReadyPartition(input: {
    provider: string;
    marketEnv: 'mock' | 'production';
    symbol: string;
    timeframe: ChartArchiveTimeframe;
    partitionKey: string;
  }): Promise<boolean> {
    if (!this.dataSource) return false;
    const rows = (await this.dataSource.query(
      `
        SELECT 1
        FROM chart_archive_manifests
        WHERE provider = $1
          AND market_env = $2
          AND symbol = $3
          AND timeframe = $4
          AND partition_key = $5
          AND status = 'READY'
          AND coverage_ratio >= 1.0
        LIMIT 1
      `,
      [input.provider, input.marketEnv, input.symbol, input.timeframe, input.partitionKey],
    )) as Array<{ '?column?': number }>;
    return rows.length > 0;
  }

  async markRunStale(runId: string, actor: string, reason: string | null): Promise<number> {
    if (!this.dataSource) return 0;
    const rows = (await this.dataSource.query(
      `
        UPDATE chart_archive_manifests
        SET status = 'STALE',
            data_revision = data_revision + 1,
            last_modified_at = NOW()
        WHERE source_run_id = $1
          AND status = 'READY'
        RETURNING id, provider, market_env AS "marketEnv", symbol, timeframe, partition_key AS "partitionKey",
          status, data_revision AS "dataRevision", archived_at AS "archivedAt"
      `,
      [runId],
    )) as Array<{
      id: number;
      provider: string;
      marketEnv: 'mock' | 'production';
      symbol: string;
      timeframe: ChartArchiveTimeframe;
      partitionKey: string;
      status: string;
      dataRevision: number;
      archivedAt: Date;
    }>;
    for (const row of rows) {
      await this.publishManifestChanged({
        provider: row.provider,
        marketEnv: row.marketEnv,
        symbol: row.symbol,
        timeframe: row.timeframe,
        partitionKey: row.partitionKey,
        status: row.status,
        dataRevision: row.dataRevision,
        archivedAt: row.archivedAt.toISOString(),
      });
    }
    await this.audit({
      runId,
      action: 'mark_stale',
      actor,
      reason,
      newStatus: 'STALE',
      metadata: {
        count: rows.length,
        manifestIds: rows.map((row) => row.id),
        partitions: rows.map((row) => ({
          timeframe: row.timeframe,
          partitionKey: row.partitionKey,
          symbol: row.symbol,
        })),
      },
    });
    return rows.length;
  }

  async findReadyManifestsForAudit(limit = 100): Promise<
    Array<{
      id: number;
      provider: string;
      marketEnv: 'mock' | 'production';
      symbol: string;
      timeframe: ChartArchiveTimeframe;
      partitionKey: string;
      s3Key: string;
      objectChecksum: string;
      contentChecksum: string;
    }>
  > {
    if (!this.dataSource) return [];
    const rows = (await this.dataSource.query(
      `
        SELECT
          id,
          provider,
          market_env AS "marketEnv",
          symbol,
          timeframe,
          partition_key AS "partitionKey",
          s3_key AS "s3Key",
          object_checksum AS "objectChecksum",
          content_checksum AS "contentChecksum"
        FROM chart_archive_manifests
        WHERE status = 'READY'
          AND s3_key IS NOT NULL
          AND object_checksum IS NOT NULL
          AND content_checksum IS NOT NULL
        ORDER BY archived_at DESC
        LIMIT $1
      `,
      [Math.max(1, Math.floor(limit))],
    )) as Array<{
      id: number;
      provider: string;
      marketEnv: 'mock' | 'production';
      symbol: string;
      timeframe: ChartArchiveTimeframe;
      partitionKey: string;
      s3Key: string;
      objectChecksum: string;
      contentChecksum: string;
    }>;
    return rows;
  }

  async markMismatch(input: {
    manifestId: number;
    actor: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.dataSource) return;
    const rows = (await this.dataSource.query(
      `
        UPDATE chart_archive_manifests
        SET status = 'MISMATCH',
            data_revision = data_revision + 1,
            last_modified_at = NOW(),
            error_message = $2
        WHERE id = $1
        RETURNING id, provider, market_env AS "marketEnv", symbol, timeframe, partition_key AS "partitionKey",
          status, data_revision AS "dataRevision", archived_at AS "archivedAt"
      `,
      [input.manifestId, input.reason],
    )) as Array<{
      id: number;
      provider: string;
      marketEnv: 'mock' | 'production';
      symbol: string;
      timeframe: ChartArchiveTimeframe;
      partitionKey: string;
      status: string;
      dataRevision: number;
      archivedAt: Date;
    }>;
    const row = rows[0];
    await this.audit({
      manifestId: input.manifestId,
      action: 'mark_mismatch',
      actor: input.actor,
      reason: input.reason,
      newStatus: 'MISMATCH',
      metadata: input.metadata ?? null,
    });
    if (!row) return;
    await this.publishManifestChanged({
      provider: row.provider,
      marketEnv: row.marketEnv,
      symbol: row.symbol,
      timeframe: row.timeframe,
      partitionKey: row.partitionKey,
      status: row.status,
      dataRevision: row.dataRevision,
      archivedAt: row.archivedAt.toISOString(),
    });
  }

  async findProblemDerivedManifests(limit = 100): Promise<
    Array<{
      id: number;
      provider: string;
      marketEnv: 'mock' | 'production';
      market: 'kr';
      symbol: string;
      stockId: number | null;
      timeframe: '1h' | '1d';
      partitionKey: string;
      sourceRunId: string;
    }>
  > {
    if (!this.dataSource) return [];
    const rows = (await this.dataSource.query(
      `
        SELECT
          id,
          provider,
          market_env AS "marketEnv",
          market,
          symbol,
          stock_id AS "stockId",
          timeframe,
          partition_key AS "partitionKey",
          source_run_id::text AS "sourceRunId"
        FROM chart_archive_manifests
        WHERE status IN ('STALE', 'MISMATCH')
          AND timeframe IN ('1h', '1d')
        ORDER BY last_modified_at ASC
        LIMIT $1
      `,
      [Math.max(1, Math.floor(limit))],
    )) as Array<{
      id: number;
      provider: string;
      marketEnv: 'mock' | 'production';
      market: 'kr';
      symbol: string;
      stockId: number | null;
      timeframe: '1h' | '1d';
      partitionKey: string;
      sourceRunId: string;
    }>;
    return rows;
  }

  async findReadyOneMinuteManifests(input: {
    provider: string;
    marketEnv: 'mock' | 'production';
    symbol: string;
    partitionKeyPrefix: string;
  }): Promise<Array<{ partitionKey: string; s3Key: string }>> {
    if (!this.dataSource) return [];
    const rows = (await this.dataSource.query(
      `
        SELECT partition_key AS "partitionKey", s3_key AS "s3Key"
        FROM chart_archive_manifests
        WHERE provider = $1
          AND market_env = $2
          AND symbol = $3
          AND timeframe = '1m'
          AND status = 'READY'
          AND s3_key IS NOT NULL
          AND partition_key LIKE $4
        ORDER BY partition_key ASC
      `,
      [input.provider, input.marketEnv, input.symbol, `${input.partitionKeyPrefix}%`],
    )) as Array<{ partitionKey: string; s3Key: string }>;
    return rows;
  }

  async manualFixManifest(input: {
    manifestId: number;
    newS3Key: string;
    contentChecksum: string;
    objectChecksum: string;
    actor: string;
    reason: string;
    sourceRunId: string;
  }): Promise<void> {
    if (!this.dataSource) return;
    const rows = (await this.dataSource.query(
      `
        UPDATE chart_archive_manifests
        SET status = 'READY',
            s3_key = $2,
            content_checksum = $3,
            object_checksum = $4,
            source_run_id = $5,
            data_revision = data_revision + 1,
            last_modified_at = NOW(),
            error_message = NULL
        WHERE id = $1
        RETURNING id, provider, market_env AS "marketEnv", symbol, timeframe, partition_key AS "partitionKey",
          status, data_revision AS "dataRevision", archived_at AS "archivedAt"
      `,
      [input.manifestId, input.newS3Key, input.contentChecksum, input.objectChecksum, input.sourceRunId],
    )) as Array<{
      id: number;
      provider: string;
      marketEnv: 'mock' | 'production';
      symbol: string;
      timeframe: ChartArchiveTimeframe;
      partitionKey: string;
      status: string;
      dataRevision: number;
      archivedAt: Date;
    }>;
    const row = rows[0];
    if (!row) throw new NotFoundException('Chart archive manifest not found');
    await this.audit({
      manifestId: input.manifestId,
      action: 'manual_fix',
      actor: input.actor,
      reason: input.reason,
      newStatus: 'READY',
      metadata: { newS3Key: input.newS3Key },
    });
    await this.publishManifestChanged({
      provider: row.provider,
      marketEnv: row.marketEnv,
      symbol: row.symbol,
      timeframe: row.timeframe,
      partitionKey: row.partitionKey,
      status: row.status,
      dataRevision: row.dataRevision,
      archivedAt: row.archivedAt.toISOString(),
    });
  }

  private async audit(input: {
    runId?: string | null;
    manifestId?: number | null;
    action: string;
    actor?: string | null;
    newStatus?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    if (!this.dataSource) return;
    await this.dataSource.query(
      `
        INSERT INTO chart_archive_task_audits (
          run_id, manifest_id, action, actor, new_status, reason, metadata_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        input.runId ?? null,
        input.manifestId ?? null,
        input.action,
        input.actor ?? null,
        input.newStatus ?? null,
        input.reason ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
  }
}
