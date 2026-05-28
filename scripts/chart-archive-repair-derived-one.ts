import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config as loadDotenv } from 'dotenv';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { Readable } from 'stream';
import { gzipSync, gunzipSync } from 'zlib';
import { createHash } from 'crypto';
import type { ArchivedCandleRow } from '../src/shared/chart-archive/chart-archive.types';

async function main(): Promise<void> {
  loadDotenv({ path: '.env.local', override: true });
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const bucket = process.env.CHART_ARCHIVE_S3_BUCKET ?? process.env.S3_BUCKET_NAME;
  if (!bucket) throw new Error('CHART_ARCHIVE_S3_BUCKET is required');
  const client = new Client({ connectionString: process.env.WORKER_DATABASE_URL });
  const s3 = new S3Client({ region: process.env.CHART_ARCHIVE_AWS_REGION ?? process.env.AWS_REGION ?? 'ap-northeast-2' });
  await client.connect();
  try {
    const source = await oneMinuteManifest(client, args);
    const oneMinuteRows = await getRows(s3, bucket, source.s3Key);
    const hourlyRows = deriveHourlyRows(oneMinuteRows);
    const dailyRows = deriveDailyRows(oneMinuteRows, args.tradeDate);
    const sourceRunId = randomUUID();
    await writeAggregate(client, s3, bucket, args, '1h', args.tradeDate.slice(0, 7), hourlyRows, sourceRunId);
    await writeAggregate(client, s3, bucket, args, '1d', args.tradeDate.slice(0, 4), dailyRows, sourceRunId);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      symbol: args.symbol,
      tradeDate: args.tradeDate,
      hourlyRows: hourlyRows.length,
      dailyRows: dailyRows.length,
      sourceRunId,
    }, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

async function oneMinuteManifest(
  client: Client,
  args: Args,
): Promise<{ s3Key: string }> {
  const res = await client.query<{ s3Key: string }>(
    `
      SELECT s3_key AS "s3Key"
      FROM chart_archive_manifests
      WHERE provider = $1
        AND market_env = $2
        AND symbol = $3
        AND timeframe = '1m'
        AND partition_key = $4
        AND status = 'READY'
      LIMIT 1
    `,
    [args.provider, args.marketEnv, args.symbol, args.tradeDate],
  );
  const row = res.rows[0];
  if (!row?.s3Key) throw new Error(`READY 1m manifest not found for ${args.symbol}/${args.tradeDate}`);
  return row;
}

async function writeAggregate(
  client: Client,
  s3: S3Client,
  bucket: string,
  args: Args,
  timeframe: '1h' | '1d',
  partitionKey: string,
  rows: ArchivedCandleRow[],
  sourceRunId: string,
): Promise<void> {
  const key = s3Key(args, timeframe, partitionKey);
  const text = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const body = gzipSync(text);
  const objectChecksum = sha256Hex(body);
  const contentChecksum = sha256Hex(text);
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/x-ndjson',
    ContentEncoding: 'gzip',
  }));
  const expected = await currentExpected(client, args, timeframe, partitionKey);
  const status = rows.length >= expected ? 'READY' : 'PARTIAL';
  const now = new Date();
  const upsert = await client.query<{ id: number; dataRevision: number }>(
    `
      INSERT INTO chart_archive_manifests (
        provider, market_env, market, symbol, stock_id, timeframe, partition_key,
        status, s3_key, sidecar_s3_key, expected_row_count, actual_row_count,
        coverage_ratio, object_checksum, content_checksum, source_checksum,
        source_run_id, schema_version, data_revision, archived_at,
        last_modified_at, error_message
      )
      VALUES ($1, $2, 'kr', $3, $4, $5, $6, $7, $8, $9, $10, $11,
        CASE WHEN $10::int = 0 THEN 1.0 ELSE $11::int::double precision / $10::int::double precision END,
        $12, $13, $14, $15, 1, 1, $16, $16, NULL)
      ON CONFLICT (provider, market_env, symbol, timeframe, partition_key)
      DO UPDATE SET
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
        data_revision = chart_archive_manifests.data_revision + 1,
        archived_at = EXCLUDED.archived_at,
        last_modified_at = EXCLUDED.last_modified_at,
        error_message = NULL
      RETURNING id, data_revision AS "dataRevision"
    `,
    [
      args.provider,
      args.marketEnv,
      args.symbol,
      null,
      timeframe,
      partitionKey,
      status,
      key,
      `${key}.manifest.json`,
      expected,
      rows.length,
      objectChecksum,
      contentChecksum,
      sha256Hex(JSON.stringify(rows)),
      sourceRunId,
      now,
    ],
  );
  const manifest = {
    id: upsert.rows[0]?.id,
    provider: args.provider,
    marketEnv: args.marketEnv,
    market: 'kr',
    symbol: args.symbol,
    timeframe,
    partitionKey,
    status,
    s3Key: key,
    expectedRowCount: expected,
    actualRowCount: rows.length,
    objectChecksum,
    contentChecksum,
    dataRevision: upsert.rows[0]?.dataRevision,
    archivedAt: now.toISOString(),
  };
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `${key}.manifest.json`,
    Body: JSON.stringify(manifest, null, 2),
    ContentType: 'application/json',
  }));
}

async function currentExpected(
  client: Client,
  args: Args,
  timeframe: '1h' | '1d',
  partitionKey: string,
): Promise<number> {
  const res = await client.query<{ expected: number }>(
    `
      SELECT COALESCE(MAX(expected_row_count), $6::int)::int AS expected
      FROM chart_archive_manifests
      WHERE provider = $1
        AND market_env = $2
        AND symbol = $3
        AND timeframe = $4
        AND partition_key = $5
    `,
    [args.provider, args.marketEnv, args.symbol, timeframe, partitionKey, timeframe === '1h' ? 7 : 1],
  );
  return res.rows[0]?.expected ?? (timeframe === '1h' ? 7 : 1);
}

async function getRows(s3: S3Client, bucket: string, key: string): Promise<ArchivedCandleRow[]> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await streamToBuffer(res.Body);
  return gunzipSync(body)
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ArchivedCandleRow);
}

function deriveHourlyRows(rows: ArchivedCandleRow[]): ArchivedCandleRow[] {
  const grouped = new Map<string, ArchivedCandleRow[]>();
  for (const row of rows) {
    const date = new Date(row.bucketStartUtc);
    date.setUTCMinutes(0, 0, 0);
    const key = date.toISOString();
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucketStartUtc, bucketRows]) => aggregateRows(bucketRows, '1h', bucketStartUtc));
}

function deriveDailyRows(rows: ArchivedCandleRow[], tradeDate: string): ArchivedCandleRow[] {
  return [aggregateRows(rows, '1d', new Date(`${tradeDate}T00:00:00.000+09:00`).toISOString())];
}

function aggregateRows(rows: ArchivedCandleRow[], timeframe: '1h' | '1d', bucketStartUtc: string): ArchivedCandleRow {
  const sorted = [...rows].sort((a, b) => a.bucketStartUtc.localeCompare(b.bucketStartUtc));
  const first = sorted[0];
  return {
    provider: first.provider,
    marketEnv: first.marketEnv,
    market: first.market,
    symbol: first.symbol,
    stockId: first.stockId,
    timeframe,
    bucketStartUtc,
    open: sorted[0].open,
    high: Math.max(...sorted.map((row) => row.high)),
    low: Math.min(...sorted.map((row) => row.low)),
    close: sorted[sorted.length - 1].close,
    volume: sorted.reduce((sum, row) => sum + row.volume, 0),
    tradingValue: null,
    source: 'derived',
    schemaVersion: 1,
    dataRevision: 1,
  };
}

function s3Key(args: Args, timeframe: '1h' | '1d', partitionKey: string): string {
  const prefix = (process.env.CHART_ARCHIVE_S3_PREFIX ?? 'charts').replace(/^\/+|\/+$/g, '');
  const partition = timeframe === '1h' ? `month=${partitionKey}` : `year=${partitionKey}`;
  return `${prefix}/provider=${args.provider}/marketEnv=${args.marketEnv}/market=kr/timeframe=${timeframe}/${partition}/symbol=${args.symbol}.jsonl.gz`;
}

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) continue;
    map.set(arg.slice(2), next);
    index += 1;
  }
  return {
    provider: map.get('provider') ?? 'kiwoom',
    marketEnv: (map.get('market-env') ?? 'mock') as 'mock' | 'production',
    symbol: map.get('symbol') ?? '005930',
    tradeDate: map.get('trade-date') ?? '2026-05-27',
  };
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  throw new Error('unsupported S3 body stream');
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

interface Args {
  provider: string;
  marketEnv: 'mock' | 'production';
  symbol: string;
  tradeDate: string;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
