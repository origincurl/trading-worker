export type ChartArchiveTimeframe = '1m' | '1h' | '1d';
export type ChartArchiveStatus = 'READY' | 'PARTIAL' | 'FAILED' | 'STALE' | 'MISMATCH' | 'NO_TRADE';
export type ChartArchiveSource = 'rest_archive' | 'rest_backfill' | 'derived' | 'manual_fix';

export interface ArchivedCandleRow {
  provider: string;
  marketEnv: 'mock' | 'production';
  market: 'kr';
  symbol: string;
  stockId: number | null;
  timeframe: ChartArchiveTimeframe;
  bucketStartUtc: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradingValue: number | null;
  source: ChartArchiveSource;
  schemaVersion: number;
  dataRevision: number;
}

export interface ChartArchiveManifestRecord {
  id?: number;
  provider: string;
  marketEnv: 'mock' | 'production';
  market: 'kr';
  symbol: string;
  stockId: number | null;
  timeframe: ChartArchiveTimeframe;
  partitionKey: string;
  status: ChartArchiveStatus;
  s3Key: string | null;
  sidecarS3Key: string | null;
  expectedRowCount: number;
  actualRowCount: number;
  coverageRatio: number;
  objectChecksum: string | null;
  contentChecksum: string | null;
  sourceChecksum: string | null;
  sourceRunId: string;
  schemaVersion: number;
  dataRevision?: number;
  archivedAt: string;
  lastModifiedAt: string;
  errorMessage?: string | null;
}
