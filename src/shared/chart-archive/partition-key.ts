import type { ChartArchiveTimeframe } from './chart-archive.types';

const KST_OFFSET_MS = 9 * 60 * 60_000;

export function normalizeBucketStartUtc(input: string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`invalid bucketStartUtc: ${String(input)}`);
  }
  return date.toISOString();
}

export function tradeDateKstFromBucket(bucketStartUtc: string | Date): string {
  const date = bucketStartUtc instanceof Date ? bucketStartUtc : new Date(bucketStartUtc);
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function partitionKeyFromBucket(
  timeframe: ChartArchiveTimeframe,
  bucketStartUtc: string | Date,
  tradeDate?: string,
): string {
  const day = tradeDate ?? tradeDateKstFromBucket(bucketStartUtc);
  if (timeframe === '1m') return day;
  if (timeframe === '1h') return day.slice(0, 7);
  return day.slice(0, 4);
}

export function chartArchiveS3Key(input: {
  prefix: string;
  provider: string;
  marketEnv: 'mock' | 'production';
  market: 'kr';
  timeframe: ChartArchiveTimeframe;
  partitionKey: string;
  symbol: string;
}): string {
  const base = `${input.prefix}/provider=${input.provider.toLowerCase()}/marketEnv=${input.marketEnv}/market=${input.market}`;
  if (input.timeframe === '1m') {
    return `${base}/timeframe=1m/tradeDate=${input.partitionKey}/symbol=${input.symbol}.jsonl.gz`;
  }
  if (input.timeframe === '1h') {
    return `${base}/timeframe=1h/month=${input.partitionKey}/symbol=${input.symbol}.jsonl.gz`;
  }
  return `${base}/timeframe=1d/year=${input.partitionKey}/symbol=${input.symbol}.jsonl.gz`;
}

export function sidecarManifestS3Key(objectKey: string): string {
  return objectKey.replace(/\.jsonl\.gz$/, '._manifest.json');
}

export function isKrxClosingAuctionBucket(bucketStartUtc: string | Date): boolean {
  const date = bucketStartUtc instanceof Date ? bucketStartUtc : new Date(bucketStartUtc);
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return minutes >= 15 * 60 + 20 && minutes < 15 * 60 + 30;
}

export function isKrxContinuousSessionBucket(bucketStartUtc: string | Date): boolean {
  const date = bucketStartUtc instanceof Date ? bucketStartUtc : new Date(bucketStartUtc);
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();

  return minutes >= 9 * 60 && minutes < 15 * 60 + 20;
}
