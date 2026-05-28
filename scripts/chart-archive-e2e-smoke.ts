import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { config as loadDotenv } from 'dotenv';
import { chartArchiveS3Key, sidecarManifestS3Key } from '../src/shared/chart-archive/partition-key';
import { gzipSync } from 'zlib';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

async function main(): Promise<void> {
  loadDotenv({ path: '.env.local', override: true });
  loadDotenv();
  const bucket = process.env.CHART_ARCHIVE_S3_BUCKET ?? process.env.S3_BUCKET_NAME;
  const region = process.env.CHART_ARCHIVE_AWS_REGION ?? process.env.AWS_REGION ?? 'ap-northeast-2';
  const prefix = process.env.CHART_ARCHIVE_S3_PREFIX ?? 'charts';
  if (!bucket) throw new Error('CHART_ARCHIVE_S3_BUCKET or S3_BUCKET_NAME is required');
  if (!process.env.WORKER_DATABASE_URL) throw new Error('WORKER_DATABASE_URL is required');

  const provider = 'kiwoom';
  const marketEnv = 'mock';
  const symbol = 'SMOKE';
  const tradeDate = new Date().toISOString().slice(0, 10);
  const sourceRunId = randomUUID();
  const rows = [0, 1, 2].map((i) => ({
    provider,
    marketEnv,
    market: 'kr',
    symbol,
    stockId: null,
    timeframe: '1m',
    bucketStartUtc: new Date(`${tradeDate}T00:0${i}:00.000Z`).toISOString(),
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 1000 + i,
    tradingValue: null,
    source: 'manual_fix',
    schemaVersion: 1,
    dataRevision: 1,
  }));
  const content = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const body = gzipSync(Buffer.from(content));
  const contentChecksum = sha256Hex(content);
  const objectChecksum = sha256Hex(body);
  const key = chartArchiveS3Key({ prefix, provider, marketEnv, market: 'kr', timeframe: '1m', partitionKey: tradeDate, symbol });
  const sidecarKey = sidecarManifestS3Key(key);
  const s3 = new S3Client({ region });
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'application/gzip' }));
  const client = new Client({ connectionString: process.env.WORKER_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `
        INSERT INTO chart_archive_manifests (
          provider, market_env, market, symbol, stock_id, timeframe, partition_key,
          status, s3_key, sidecar_s3_key, expected_row_count, actual_row_count,
          coverage_ratio, object_checksum, content_checksum, source_checksum,
          source_run_id, schema_version, data_revision, archived_at, last_modified_at
        )
        VALUES ($1,$2,'kr',$3,NULL,'1m',$4,'READY',$5,$6,3,3,1.0,$7,$8,$9,$10,1,1,NOW(),NOW())
        ON CONFLICT (provider, market_env, symbol, timeframe, partition_key)
        DO UPDATE SET status='READY', s3_key=EXCLUDED.s3_key, object_checksum=EXCLUDED.object_checksum,
          content_checksum=EXCLUDED.content_checksum, source_run_id=EXCLUDED.source_run_id,
          actual_row_count=3, expected_row_count=3, coverage_ratio=1.0, last_modified_at=NOW()
      `,
      [provider, marketEnv, symbol, tradeDate, key, sidecarKey, objectChecksum, contentChecksum, sha256Hex(JSON.stringify(rows)), sourceRunId],
    );
  } finally {
    await client.end();
  }
  console.log(JSON.stringify({ ok: true, bucket, key, sourceRunId }));
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
