import { Inject, Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { gzipSync, gunzipSync } from 'zlib';
import { createHash } from 'crypto';
import { CHART_ARCHIVE_CONFIG, type ChartArchiveConfig } from '@config/chart-archive.config';
import type { ArchivedCandleRow, ChartArchiveManifestRecord } from '@shared/chart-archive/chart-archive.types';

@Injectable()
export class ChartArchiveS3Service {
  private readonly client: S3Client;

  constructor(@Inject(CHART_ARCHIVE_CONFIG) private readonly config: ChartArchiveConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.s3Endpoint || undefined,
      forcePathStyle: config.s3ForcePathStyle || Boolean(config.s3Endpoint),
    });
  }

  async putRows(key: string, rows: readonly ArchivedCandleRow[]): Promise<{
    readonly objectChecksum: string;
    readonly contentChecksum: string;
    readonly bytes: number;
  }> {
    const content = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '');
    const body = gzipSync(Buffer.from(content, 'utf8'));
    const contentChecksum = sha256Hex(content);
    const objectChecksum = sha256Hex(body);
    if (!this.config.dryRun) {
      await this.putObject(key, body, 'application/gzip');
    }
    return { objectChecksum, contentChecksum, bytes: body.byteLength };
  }

  async putSidecar(key: string, manifest: ChartArchiveManifestRecord): Promise<void> {
    if (this.config.dryRun) return;
    await this.putObject(key, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), 'application/json');
  }

  async getRows(key: string): Promise<ArchivedCandleRow[]> {
    if (!this.config.bucket) return [];
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      const body = await streamToBuffer(res.Body);
      const text = gunzipSync(body).toString('utf8');
      return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ArchivedCandleRow);
    } catch (err) {
      if (err instanceof NoSuchKey || (err instanceof Error && err.name === 'NoSuchKey')) return [];
      throw err;
    }
  }

  async verifyRowsObject(
    key: string,
    expected: { objectChecksum: string; contentChecksum: string },
  ): Promise<void> {
    if (!this.config.bucket) {
      throw new Error('CHART_ARCHIVE_S3_BUCKET is required when CHART_ARCHIVE_ENABLED=true');
    }
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    const body = await streamToBuffer(res.Body);
    const objectChecksum = sha256Hex(body);
    const content = gunzipSync(body).toString('utf8');
    const contentChecksum = sha256Hex(content);
    if (
      objectChecksum !== expected.objectChecksum ||
      contentChecksum !== expected.contentChecksum
    ) {
      throw new Error('replacement object checksum mismatch');
    }
  }

  private async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.config.bucket) {
      throw new Error('CHART_ARCHIVE_S3_BUCKET is required when CHART_ARCHIVE_ENABLED=true');
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
  }
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
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
