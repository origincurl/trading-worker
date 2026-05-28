import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { chartArchiveS3Key, sidecarManifestS3Key } from '@shared/chart-archive/partition-key';
import type { ArchivedCandleRow, ChartArchiveManifestRecord } from '@shared/chart-archive/chart-archive.types';
import type { ChartArchiveConfig } from '@config/chart-archive.config';
import { ChartArchiveS3Service } from './chart-archive-s3.service';

const endpoint = process.env.CHART_ARCHIVE_S3_ENDPOINT ?? process.env.AWS_ENDPOINT_URL_S3;
const describeS3 = endpoint ? describe : describe.skip;

describeS3('ChartArchiveS3Service S3-compatible integration', () => {
  const bucket = process.env.CHART_ARCHIVE_S3_BUCKET ?? 'chart-archive-it';
  const region = process.env.CHART_ARCHIVE_AWS_REGION ?? process.env.AWS_REGION ?? 'ap-northeast-2';
  const prefix = `charts-it/${randomUUID()}`;
  const s3 = new S3Client({
    region,
    endpoint,
    forcePathStyle: parseBool(process.env.CHART_ARCHIVE_S3_FORCE_PATH_STYLE, true),
  });
  const config: ChartArchiveConfig = {
    enabled: true,
    dryRun: false,
    bucket,
    prefix,
    region,
    s3Endpoint: endpoint ?? '',
    s3ForcePathStyle: true,
    marketEnvs: ['mock'],
    priority: 'P3',
    concurrency: 1,
    lockTtlSec: 7200,
    aggregateLockTtlSec: 120,
    timeKst: '20:00',
    windowEndKst: '06:00',
    taskMaxAttempts: 5,
    aggregateLockRetryCount: 1,
    aggregateLockRetryDelayMs: 100,
    calendarSyncEnabled: false,
    calendarSyncTimeKst: '06:10',
    calendarSyncUrl: '',
    calendarSyncFile: '',
    calendarRequireDb: false,
  };
  const service = new ChartArchiveS3Service(config);
  const key = chartArchiveS3Key({
    prefix,
    provider: 'kiwoom',
    marketEnv: 'mock',
    market: 'kr',
    timeframe: '1m',
    partitionKey: '2026-05-27',
    symbol: `IT${randomUUID().replace(/-/g, '').slice(0, 8)}`,
  });
  const sidecarKey = sidecarManifestS3Key(key);

  beforeAll(async () => {
    await ensureBucket(s3, bucket);
  });

  afterAll(async () => {
    await Promise.allSettled([
      s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
      s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: sidecarKey })),
    ]);
    s3.destroy();
  });

  it('writes, reads, verifies rows, and writes sidecar manifest', async () => {
    const rows: ArchivedCandleRow[] = [
      candle('2026-05-27T00:00:00.000Z', 1000),
      candle('2026-05-27T00:01:00.000Z', 1010),
    ];

    const checksums = await service.putRows(key, rows);
    await expect(service.getRows(key)).resolves.toEqual(rows);
    await expect(service.verifyRowsObject(key, checksums)).resolves.toBeUndefined();

    const manifest: ChartArchiveManifestRecord = {
      provider: 'kiwoom',
      marketEnv: 'mock',
      market: 'kr',
      symbol: rows[0].symbol,
      stockId: null,
      timeframe: '1m',
      partitionKey: '2026-05-27',
      status: 'READY',
      s3Key: key,
      sidecarS3Key: sidecarKey,
      expectedRowCount: rows.length,
      actualRowCount: rows.length,
      coverageRatio: 1,
      contentChecksum: checksums.contentChecksum,
      objectChecksum: checksums.objectChecksum,
      sourceChecksum: null,
      dataRevision: 1,
      archivedAt: '2026-05-27T11:00:00.000Z',
      lastModifiedAt: '2026-05-27T11:00:00.000Z',
      sourceRunId: 'integration-test',
      schemaVersion: 1,
    };
    await expect(service.putSidecar(sidecarKey, manifest)).resolves.toBeUndefined();
  });
});

function candle(bucketStartUtc: string, close: number): ArchivedCandleRow {
  return {
    provider: 'kiwoom',
    marketEnv: 'mock',
    market: 'kr',
    symbol: '005930',
    timeframe: '1m',
    bucketStartUtc,
    open: close - 5,
    high: close + 10,
    low: close - 10,
    close,
    volume: 100,
    tradingValue: null,
    source: 'rest_archive',
    stockId: null,
    schemaVersion: 1,
    dataRevision: 1,
  };
}

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}
