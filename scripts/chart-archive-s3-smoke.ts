import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config as loadDotenv } from 'dotenv';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';

async function main(): Promise<void> {
  loadDotenv({ path: '.env.local', override: true });
  loadDotenv();

  const bucket = process.env.CHART_ARCHIVE_S3_BUCKET ?? process.env.S3_BUCKET_NAME;
  const region = process.env.CHART_ARCHIVE_AWS_REGION ?? process.env.AWS_REGION ?? 'ap-northeast-2';
  const endpoint = process.env.CHART_ARCHIVE_S3_ENDPOINT ?? process.env.AWS_ENDPOINT_URL_S3;
  const prefix = (process.env.CHART_ARCHIVE_S3_PREFIX ?? 'charts').replace(/^\/+|\/+$/g, '');
  if (!bucket) throw new Error('CHART_ARCHIVE_S3_BUCKET or S3_BUCKET_NAME is required');

  const client = new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: parseBool(process.env.CHART_ARCHIVE_S3_FORCE_PATH_STYLE, Boolean(endpoint)),
  });
  const key = `${prefix}/_smoke/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.txt`;
  const body = Buffer.from(`chart archive s3 smoke ${new Date().toISOString()}\n`, 'utf8');

  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'text/plain' }));
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const read = await streamToBuffer(res.Body);
  if (!read.equals(body)) throw new Error('S3 smoke read body mismatch');
  console.log(JSON.stringify({ ok: true, bucket, key, bytes: body.byteLength }));
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
