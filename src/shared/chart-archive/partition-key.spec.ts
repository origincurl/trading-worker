import {
  isKrxClosingAuctionBucket,
  isKrxContinuousSessionBucket,
  normalizeBucketStartUtc,
  partitionKeyFromBucket,
  sidecarManifestS3Key,
} from './partition-key';

describe('chart archive partition key helpers', () => {
  it('normalizes bucketStartUtc to millisecond Z ISO format', () => {
    expect(normalizeBucketStartUtc('2026-05-28T00:00:00Z')).toBe('2026-05-28T00:00:00.000Z');
  });

  it('derives timeframe partition keys from KST trade date', () => {
    const bucket = '2026-05-28T00:00:00.000Z';

    expect(partitionKeyFromBucket('1m', bucket)).toBe('2026-05-28');
    expect(partitionKeyFromBucket('1h', bucket)).toBe('2026-05');
    expect(partitionKeyFromBucket('1d', bucket)).toBe('2026');
  });

  it('detects KRX closing auction buckets', () => {
    expect(isKrxClosingAuctionBucket('2026-05-28T06:19:00.000Z')).toBe(false);
    expect(isKrxClosingAuctionBucket('2026-05-28T06:20:00.000Z')).toBe(true);
    expect(isKrxClosingAuctionBucket('2026-05-28T06:29:00.000Z')).toBe(true);
    expect(isKrxClosingAuctionBucket('2026-05-28T06:30:00.000Z')).toBe(false);
  });

  it('detects KRX continuous session buckets', () => {
    expect(isKrxContinuousSessionBucket('2026-05-28T00:00:00.000Z')).toBe(true);
    expect(isKrxContinuousSessionBucket('2026-05-28T06:19:00.000Z')).toBe(true);
    expect(isKrxContinuousSessionBucket('2026-05-28T06:20:00.000Z')).toBe(false);
    expect(isKrxContinuousSessionBucket('2026-05-28T06:40:00.000Z')).toBe(false);
  });

  it('places per-object sidecar manifest next to the jsonl object', () => {
    expect(sidecarManifestS3Key('charts/a/symbol=005930.jsonl.gz')).toBe(
      'charts/a/symbol=005930._manifest.json',
    );
  });
});
