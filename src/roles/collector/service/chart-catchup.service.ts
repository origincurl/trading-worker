import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { COLLECTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import {
  CANDLE_REPOSITORY,
  type CandleRepository,
} from '@roles/collector/repository/candle.repository';
import { isKrxContinuousSessionBucket } from '@shared/chart-archive/partition-key';
import type {
  CandleChartMarket,
  MarketCandleClosedPayload,
} from '@shared/event/market-candle-closed.event';
import { ChartArchiveWriterService } from '@roles/collector/chart-archive/chart-archive-writer.service';
import { ChartEmptyRangeService } from './chart-empty-range.service';

// Phase E: actual catchup execution body — vendor fetch + candle upsert.
// Consolidates what used to live in process-chart-catchup-lease.usecase.
// Caller (ProcessChartCatchupUsecase) wraps this with payload validation
// and reporting back to redis.
export interface ChartCatchupRequest {
  readonly requestId: string;
  readonly marketEnv: 'mock' | 'production';
  readonly symbol: string;
  readonly chartMarket?: CandleChartMarket;
  readonly intervalType: '1m' | '1d';
  readonly baseDt?: string;
  readonly fromIso: string;
  readonly toIso: string;
  readonly acceptFromIso?: string;
  readonly acceptToIso?: string;
  readonly targetFromIso?: string;
  readonly targetToIso?: string;
  readonly targetRanges?: ReadonlyArray<{
    readonly fromIso: string;
    readonly toIso: string;
  }>;
  readonly archiveToS3?: boolean;
}

export interface ChartCatchupResult {
  readonly candlesWritten: number;
  readonly candlesSkipped: number;
  readonly errors: ReadonlyArray<{ code: string; detail: string }>;
}

@Injectable()
export class ChartCatchupService {
  private readonly logger = new Logger(ChartCatchupService.name);

  constructor(
    @Inject(COLLECTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Inject(CANDLE_REPOSITORY) private readonly repo: CandleRepository,
    private readonly emptyRanges: ChartEmptyRangeService,
    private readonly archiveWriter: ChartArchiveWriterService,
  ) {}

  async run(request: ChartCatchupRequest): Promise<ChartCatchupResult> {
    const errors: { code: string; detail: string }[] = [];
    let written = 0;
    let skipped = 0;

    try {
      const rows: MarketCandleClosedPayload[] = await this.gateway.fetchChartCandles({
        requestId: request.requestId,
        symbol: request.symbol,
        marketEnv: request.marketEnv,
        chartMarket: request.chartMarket,
        intervalType: request.intervalType,
        fromIso: request.fromIso,
        toIso: request.toIso,
        baseDt: request.baseDt,
        acceptFromIso: request.acceptFromIso,
        acceptToIso: request.acceptToIso,
      });
      const persistableRows = rows.filter((row) => isPersistableCatchupRow(request, row));

      for (const row of persistableRows) {
        const r = await this.repo.upsertClosed(row);

        if (r === 'skipped') skipped += 1;
        else written += 1;
      }

      await this.recordEmptyTargets(request, persistableRows);
      if (request.archiveToS3) {
        if (request.intervalType === '1m') {
          await this.archiveCatchupRows(request, persistableRows).catch((err) => {
            this.logger.warn(
              `catchup S3 archive failed request=${request.requestId}: ${
                err instanceof Error ? err.message : err
              }`,
            );
          });
        } else {
          this.logger.warn(
            `skip S3 archive catchup for non-1m request=${request.requestId} interval=${request.intervalType}`,
          );
        }
      }
    } catch (err) {
      errors.push({
        code: 'kiwoom-chart-failed',
        detail: err instanceof Error ? err.message : String(err),
      });

      this.logger.warn(
        `catchup request=${request.requestId} failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { candlesWritten: written, candlesSkipped: skipped, errors };
  }

  private async archiveCatchupRows(
    request: ChartCatchupRequest,
    rows: readonly MarketCandleClosedPayload[],
  ): Promise<void> {
    const byTradeDate = new Map<string, MarketCandleClosedPayload[]>();
    for (const row of rows) {
      const tradeDate = toKstTradeDate(row.bucketStart);
      byTradeDate.set(tradeDate, [...(byTradeDate.get(tradeDate) ?? []), row]);
    }
    for (const [tradeDate, candles] of byTradeDate.entries()) {
      await this.archiveWriter.archiveBackfillCandles({
        marketEnv: request.marketEnv,
        symbol: request.symbol,
        tradeDate,
        sourceRunId: stableUuidFromRequestId(request.requestId),
        candles,
        requireReady: true,
      });
    }
  }

  private async recordEmptyTargets(
    request: ChartCatchupRequest,
    rows: readonly MarketCandleClosedPayload[],
  ): Promise<void> {
    const targetRanges =
      request.targetRanges && request.targetRanges.length > 0
        ? request.targetRanges
        : [
            {
              fromIso: request.targetFromIso ?? request.fromIso,
              toIso: request.targetToIso ?? request.toIso,
            },
          ];

    for (const target of targetRanges) {
      const fromMs = Date.parse(target.fromIso);
      const toMs = Date.parse(target.toIso);
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) continue;

      const hasRowsInTarget = rows.some((row) => {
        const bucketStartMs = Date.parse(row.bucketStart);

        return Number.isFinite(bucketStartMs) && bucketStartMs >= fromMs && bucketStartMs < toMs;
      });

      if (!hasRowsInTarget) {
        await this.emptyRanges.recordEmptyRange(request, target.fromIso, target.toIso, 'transient');
      }
    }
  }
}

function toKstTradeDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

function isPersistableCatchupRow(
  request: ChartCatchupRequest,
  row: MarketCandleClosedPayload,
): boolean {
  if (request.intervalType !== '1m') return true;

  return isKrxContinuousSessionBucket(row.bucketStart);
}

function stableUuidFromRequestId(requestId: string): string {
  const hex = createHash('sha256').update(requestId).digest('hex').slice(0, 32);

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
