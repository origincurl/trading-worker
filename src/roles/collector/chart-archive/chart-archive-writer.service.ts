import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CHART_ARCHIVE_CONFIG, type ChartArchiveConfig } from '@config/chart-archive.config';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import type { MarketCandleClosedPayload } from '@shared/event/market-candle-closed.event';
import { COLLECTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import { STOCK_REPOSITORY } from '@shared/persistence/stock/stock.token';
import type { StockRepository } from '@shared/persistence/stock/stock.repository';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.tokens';
import type { ArchivedCandleRow, ChartArchiveManifestRecord } from '@shared/chart-archive/chart-archive.types';
import {
  chartArchiveS3Key,
  isKrxContinuousSessionBucket,
  partitionKeyFromBucket,
  sidecarManifestS3Key,
} from '@shared/chart-archive/partition-key';
import { ChartArchiveS3Service, sha256Hex } from './chart-archive-s3.service';
import { ChartArchiveManifestRepository } from './chart-archive-manifest.repository';
import { ChartArchiveTaskRepository, type ChartArchiveTaskKey } from './chart-archive-task.repository';
import { KrxCalendarService } from './krx-calendar.service';
import { SyncStockListUsecase } from '../usecase/sync-stock-list.usecase';
import { ChartArchiveAlertService } from './chart-archive-alert.service';

@Injectable()
export class ChartArchiveWriterService {
  private readonly logger = new Logger(ChartArchiveWriterService.name);

  constructor(
    @Inject(CHART_ARCHIVE_CONFIG) private readonly config: ChartArchiveConfig,
    @Inject(COLLECTOR_BROKERAGE_VENDOR) private readonly vendor: BrokerageVendor,
    @Inject(STOCK_REPOSITORY) private readonly stocks: StockRepository,
    private readonly s3: ChartArchiveS3Service,
    private readonly manifests: ChartArchiveManifestRepository,
    private readonly tasks: ChartArchiveTaskRepository,
    private readonly calendar: KrxCalendarService,
    private readonly syncStockList: SyncStockListUsecase,
    private readonly alerts: ChartArchiveAlertService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: RedisClientToken,
  ) {}

  async archiveTradeDate(
    tradeDate: string,
    sourceRunId: string = randomUUID(),
    options: {
      recoverStranded?: boolean;
      skipPreflight?: boolean;
      enforceWindowPerSymbol?: boolean;
      symbols?: readonly string[];
      symbolShard?: { index: number; total: number };
      budgetSymbolsPerDay?: number;
      skipIfReady?: boolean;
      writeDerived?: boolean;
      derivedTimeframes?: readonly ('1h' | '1d')[];
    } = {},
  ): Promise<void> {
    if (!this.config.enabled) return;
    if (!this.config.dryRun) await this.tasks.resetOrphanedRunningTasks(30);
    if (options.recoverStranded !== false) {
      await this.recoverStrandedBefore(tradeDate);
    }
    if (options.skipPreflight !== true) {
      try {
        await this.assertStockMasterReady(tradeDate);
      } catch (err) {
        await this.raiseArchiveAlert({
          severity: 'critical',
          subject: `chart archive preflight failed ${tradeDate}`,
          message: err instanceof Error ? err.message : String(err),
          metadata: { tradeDate, sourceRunId },
        });
        throw err;
      }
    }
    const allUniverse = await this.stocks.findActiveListedStocks();
    const symbolFilter = options.symbols?.length ? new Set(options.symbols) : null;
    let universe = symbolFilter ? allUniverse.filter((stock) => symbolFilter.has(stock.symbol)) : allUniverse;
    if (options.symbolShard && options.symbolShard.total > 0) {
      universe = universe.filter(
        (stock) => positiveHash(stock.symbol) % options.symbolShard!.total === options.symbolShard!.index,
      );
    }
    if (options.budgetSymbolsPerDay && Number.isFinite(options.budgetSymbolsPerDay)) {
      universe = universe.slice(0, options.budgetSymbolsPerDay);
    }
    if (universe.length === 0) {
      this.logger.warn('chart archive skipped: active listed stock universe is empty');
      return;
    }

    for (const marketEnv of this.config.marketEnvs) {
      const taskKeys = universe.map((stock): ChartArchiveTaskKey => ({
        runId: sourceRunId,
        provider: 'kiwoom',
        marketEnv,
        symbol: stock.symbol,
        timeframe: '1m',
        partitionKey: tradeDate,
      }));
      if (!this.config.dryRun) await this.tasks.createPendingTasks(taskKeys);

      const prioritizedUniverse = await this.prioritizeUniverse(universe, marketEnv, tradeDate);
      const prioritizedTaskKeys = prioritizedUniverse.map((stock): ChartArchiveTaskKey => ({
        runId: sourceRunId,
        provider: 'kiwoom',
        marketEnv,
        symbol: stock.symbol,
        timeframe: '1m',
        partitionKey: tradeDate,
      }));

      if (!this.calendar.isTradingDay(tradeDate)) {
        await this.writeNoTradeManifests(marketEnv, tradeDate, sourceRunId, prioritizedUniverse, prioritizedTaskKeys);
        continue;
      }

      await mapLimit(prioritizedUniverse, this.config.concurrency, async (stock, index) => {
        const task = prioritizedTaskKeys[index];
        if (
          options.enforceWindowPerSymbol !== false &&
          !isInsideKstArchiveWindow(new Date(), this.config.timeKst, this.config.windowEndKst)
        ) {
          if (!this.config.dryRun) {
            await this.tasks.markPending(task, `archive window closed at ${this.config.windowEndKst} KST`);
          }
          return;
        }
        try {
          if (!this.config.dryRun) {
            const state = await this.tasks.markRunning(task, this.config.taskMaxAttempts);
            if (state === 'SKIPPED') return;
          }
          if (
            options.skipIfReady &&
            (await this.manifests.isReadyPartition({
              provider: 'kiwoom',
              marketEnv,
              symbol: stock.symbol,
              timeframe: '1m',
              partitionKey: tradeDate,
            }))
          ) {
            if (!this.config.dryRun) await this.tasks.markReady(task);
            return;
          }
          await this.archiveSymbol({
            provider: 'kiwoom',
            marketEnv,
            symbol: stock.symbol,
            stockId: Number(stock.id),
            tradeDate,
            sourceRunId,
            writeDerived: options.writeDerived !== false,
            derivedTimeframes: options.derivedTimeframes,
          });
          if (!this.config.dryRun) await this.tasks.markReady(task);
        } catch (err) {
          if (!this.config.dryRun) await this.tasks.markFailed(task, err);
          await this.raiseArchiveAlert({
            severity: 'warning',
            subject: `chart archive task failed ${stock.symbol}/${tradeDate}`,
            message: err instanceof Error ? err.message : String(err),
            metadata: { tradeDate, sourceRunId, symbol: stock.symbol, marketEnv },
          });
          this.logger.warn(
            `chart archive task failed ${stock.symbol}/${tradeDate}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      });
    }
  }

  async recoverStrandedBefore(tradeDate: string): Promise<void> {
    for (const marketEnv of this.config.marketEnvs) {
      const dates = await this.tasks.findStrandedTradeDates({
        provider: 'kiwoom',
        marketEnv,
        beforePartitionKey: tradeDate,
        limit: 7,
      });
      for (const strandedTradeDate of dates.reverse()) {
        if (!isInsideKstArchiveWindow(new Date(), this.config.timeKst, this.config.windowEndKst)) {
          this.logger.warn(`skip stranded recovery outside archive window for ${marketEnv}/${strandedTradeDate}`);
          return;
        }
        const recoveryRunId = randomUUID();
        this.logger.warn(`recovering stranded chart archive tasks for ${marketEnv}/${strandedTradeDate}`);
        await this.archiveTradeDate(strandedTradeDate, recoveryRunId, {
          recoverStranded: false,
          enforceWindowPerSymbol: false,
        });
        const superseded = await this.tasks.markSupersededStranded({
          provider: 'kiwoom',
          marketEnv,
          partitionKey: strandedTradeDate,
          supersededByRunId: recoveryRunId,
        });
        if (superseded > 0) {
          this.logger.warn(`marked ${superseded} old stranded tasks SKIPPED for ${marketEnv}/${strandedTradeDate}`);
        }
      }
    }
  }

  async rebuildStaleDerivedManifests(limit = 100): Promise<{ rebuilt: number; skipped: number }> {
    const stale = await this.manifests.findProblemDerivedManifests(limit);
    let rebuilt = 0;
    let skipped = 0;
    for (const manifest of stale) {
      const partitionPrefix = manifest.timeframe === '1h' ? `${manifest.partitionKey}-` : manifest.partitionKey;
      const sources = await this.manifests.findReadyOneMinuteManifests({
        provider: manifest.provider,
        marketEnv: manifest.marketEnv,
        symbol: manifest.symbol,
        partitionKeyPrefix: partitionPrefix,
      });
      if (sources.length === 0) {
        skipped += 1;
        continue;
      }
      const rows: ArchivedCandleRow[] = [];
      for (const source of sources) rows.push(...(await this.s3.getRows(source.s3Key)));
      if (rows.length === 0) {
        skipped += 1;
        continue;
      }
      const maxTradeDate = maxKstTradeDate(rows, sources[sources.length - 1].partitionKey);
      await this.writeAggregatePartitions(
        {
          provider: manifest.provider,
          marketEnv: manifest.marketEnv,
          symbol: manifest.symbol,
          stockId: manifest.stockId,
          tradeDate: maxTradeDate,
          sourceRunId: manifest.sourceRunId,
        },
        rows,
        [manifest.timeframe],
      );
      rebuilt += 1;
    }
    return { rebuilt, skipped };
  }

  async rebuildDerivedForDate(
    tradeDate: string,
    sourceRunId: string = randomUUID(),
    options: {
      symbols?: readonly string[];
      symbolShard?: { index: number; total: number };
      budgetSymbolsPerDay?: number;
      derivedTimeframes?: readonly ('1h' | '1d')[];
    } = {},
  ): Promise<{ rebuilt: number; skipped: number }> {
    if (!this.config.enabled) return { rebuilt: 0, skipped: 0 };
    const allUniverse = await this.stocks.findActiveListedStocks();
    const symbolFilter = options.symbols?.length ? new Set(options.symbols) : null;
    let universe = symbolFilter ? allUniverse.filter((stock) => symbolFilter.has(stock.symbol)) : allUniverse;
    if (options.symbolShard && options.symbolShard.total > 0) {
      universe = universe.filter(
        (stock) => positiveHash(stock.symbol) % options.symbolShard!.total === options.symbolShard!.index,
      );
    }
    if (options.budgetSymbolsPerDay && Number.isFinite(options.budgetSymbolsPerDay)) {
      universe = universe.slice(0, options.budgetSymbolsPerDay);
    }

    let rebuilt = 0;
    let skipped = 0;
    for (const marketEnv of this.config.marketEnvs) {
      await mapLimit(universe, this.config.concurrency, async (stock) => {
        const sources = await this.manifests.findReadyOneMinuteManifests({
          provider: 'kiwoom',
          marketEnv,
          symbol: stock.symbol,
          partitionKeyPrefix: tradeDate.slice(0, 7),
        });
        if (sources.length === 0) {
          skipped += 1;
          return;
        }
        const rows: ArchivedCandleRow[] = [];
        for (const source of sources) rows.push(...(await this.s3.getRows(source.s3Key)));
        if (rows.length === 0) {
          skipped += 1;
          return;
        }
        await this.writeAggregatePartitions(
          {
            provider: 'kiwoom',
            marketEnv,
            symbol: stock.symbol,
            stockId: Number(stock.id),
            tradeDate,
            sourceRunId,
          },
          rows,
          options.derivedTimeframes,
        );
        rebuilt += 1;
      });
    }
    return { rebuilt, skipped };
  }

  private async prioritizeUniverse<T extends { symbol: string }>(
    universe: readonly T[],
    marketEnv: 'mock' | 'production',
    tradeDate: string,
  ): Promise<T[]> {
    const carryover = new Set(
      await this.tasks.findCarryoverSymbols({
        provider: 'kiwoom',
        marketEnv,
        partitionKey: tradeDate,
      }),
    );
    return [...universe].sort((a, b) => {
      const ap = carryover.has(a.symbol) ? 0 : 1;
      const bp = carryover.has(b.symbol) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.symbol.localeCompare(b.symbol);
    });
  }

  private async assertStockMasterReady(tradeDate: string): Promise<void> {
    const threshold = stockMasterSyncThreshold(tradeDate);
    const initial = await this.stocks.getArchivePreflightStats(threshold);
    if (stockMasterReady(initial, threshold)) return;

    this.logger.warn(
      `stock master preflight stale; running inline stock-list sync before archive: ${formatPreflightStats(
        initial,
        threshold,
      )}`,
    );
    await this.syncStockList.execute();

    const stats = await this.stocks.getArchivePreflightStats(threshold);
    if (!stockMasterReady(stats, threshold)) {
      throw new Error(
        `stock master preflight failed after inline sync: ${formatPreflightStats(stats, threshold)}`,
      );
    }
  }

  private async archiveSymbol(input: {
    provider: string;
    marketEnv: 'mock' | 'production';
    symbol: string;
    stockId: number;
    tradeDate: string;
    sourceRunId: string;
    writeDerived?: boolean;
    derivedTimeframes?: readonly ('1h' | '1d')[];
  }): Promise<void> {
    const fromIso = `${input.tradeDate}T00:00:00.000Z`;
    const toIso = `${input.tradeDate}T06:20:00.000Z`;
    const candles = await this.vendor.fetchChartCandles({
      requestId: input.sourceRunId,
      symbol: input.symbol,
      marketEnv: input.marketEnv,
      intervalType: '1m',
      chartMarket: input.marketEnv === 'production' ? 'AL' : 'KRW',
      fromIso,
      toIso,
      baseDt: input.tradeDate.replaceAll('-', ''),
      acceptFromIso: fromIso,
      acceptToIso: toIso,
      priority: this.config.priority,
    });
    const rows: ArchivedCandleRow[] = candles
      .filter((c) => isKrxContinuousSessionBucket(c.bucketStart))
      .map((c) => ({
        provider: input.provider,
        marketEnv: input.marketEnv,
        market: 'kr',
        symbol: input.symbol,
        stockId: input.stockId,
        timeframe: '1m',
        bucketStartUtc: new Date(c.bucketStart).toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        tradingValue: c.tradingValue ?? null,
        source: 'rest_archive',
        schemaVersion: 1,
        dataRevision: 1,
      }));
    const partitionKey = input.tradeDate;
    const key = chartArchiveS3Key({
      prefix: this.config.prefix,
      provider: input.provider,
      marketEnv: input.marketEnv,
      market: 'kr',
      timeframe: '1m',
      partitionKey,
      symbol: input.symbol,
    });
    await this.withPartitionLock(input, '1m', partitionKey, async () => {
      const existing = this.config.dryRun ? [] : await this.s3.getRows(key);
      const merged = mergeRows(existing, rows);
      const expected = this.calendar.expectedOneMinuteRows(input.tradeDate);
      const status = merged.length >= expected ? 'READY' : 'PARTIAL';
      await this.writePartition(input, '1m', partitionKey, merged, expected, status);
      if (input.writeDerived !== false && status === 'READY') {
        await this.writeAggregatePartitions(input, merged, input.derivedTimeframes);
      }
    });
  }

  async archiveBackfillCandles(input: {
    marketEnv: 'mock' | 'production';
    symbol: string;
    tradeDate: string;
    sourceRunId: string;
    candles: readonly MarketCandleClosedPayload[];
    requireReady?: boolean;
  }): Promise<void> {
    if (!this.calendar.isTradingDay(input.tradeDate)) {
      this.logger.warn(
        `skip S3 catchup archive for non-trading day ${input.symbol}/${input.tradeDate}`,
      );
      return;
    }
    const stock = await this.stocks.findBySymbol(input.symbol);
    const stockId = stock?.id ? Number(stock.id) : null;
    const baseInput = {
      provider: 'kiwoom',
      marketEnv: input.marketEnv,
      symbol: input.symbol,
      stockId,
      tradeDate: input.tradeDate,
      sourceRunId: input.sourceRunId,
    };
    const incomingRows: ArchivedCandleRow[] = input.candles
      .filter((c) => isKrxContinuousSessionBucket(c.bucketStart))
      .map((c) => ({
        provider: baseInput.provider,
        marketEnv: baseInput.marketEnv,
        market: 'kr',
        symbol: baseInput.symbol,
        stockId,
        timeframe: '1m',
        bucketStartUtc: new Date(c.bucketStart).toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        tradingValue: c.tradingValue ?? null,
        source: 'rest_backfill',
        schemaVersion: 1,
        dataRevision: 1,
      }));
    if (incomingRows.length === 0) return;

    const partitionKey = input.tradeDate;
    const key = chartArchiveS3Key({
      prefix: this.config.prefix,
      provider: baseInput.provider,
      marketEnv: baseInput.marketEnv,
      market: 'kr',
      timeframe: '1m',
      partitionKey,
      symbol: baseInput.symbol,
    });

    await this.withPartitionLock(baseInput, '1m', partitionKey, async () => {
      const existing = this.config.dryRun ? [] : await this.s3.getRows(key);
      const merged = mergeRows(existing, incomingRows);
      const expected = this.calendar.expectedOneMinuteRows(input.tradeDate);
      const status = merged.length >= expected ? 'READY' : 'PARTIAL';
      if (input.requireReady && status !== 'READY') {
        this.logger.log(
          `skip S3 catchup archive until full partition is ready ${input.symbol}/${input.tradeDate} rows=${merged.length}/${expected}`,
        );
        return;
      }
      await this.writePartition(baseInput, '1m', partitionKey, merged, expected, status);
      if (status === 'READY') await this.writeAggregatePartitions(baseInput, merged);
    });
  }

  async backfillTradingValueForDate(
    tradeDate: string,
    sourceRunId: string = randomUUID(),
    options: {
      symbols?: readonly string[];
      symbolShard?: { index: number; total: number };
      budgetSymbolsPerDay?: number;
      skipIfReady?: boolean;
    } = {},
  ): Promise<{ updated: number; skipped: number }> {
    if (!this.config.enabled) return { updated: 0, skipped: 0 };
    if (!this.calendar.isTradingDay(tradeDate)) return { updated: 0, skipped: 0 };
    const allUniverse = await this.stocks.findActiveListedStocks();
    const symbolFilter = options.symbols?.length ? new Set(options.symbols) : null;
    let universe = symbolFilter ? allUniverse.filter((stock) => symbolFilter.has(stock.symbol)) : allUniverse;
    if (options.symbolShard && options.symbolShard.total > 0) {
      universe = universe.filter(
        (stock) => positiveHash(stock.symbol) % options.symbolShard!.total === options.symbolShard!.index,
      );
    }
    if (options.budgetSymbolsPerDay && Number.isFinite(options.budgetSymbolsPerDay)) {
      universe = universe.slice(0, options.budgetSymbolsPerDay);
    }
    let updated = 0;
    let skipped = 0;

    for (const marketEnv of this.config.marketEnvs) {
      await mapLimit(universe, this.config.concurrency, async (stock) => {
        const result = await this.backfillSymbolTradingValue({
          provider: 'kiwoom',
          marketEnv,
          symbol: stock.symbol,
          stockId: Number(stock.id),
          tradeDate,
          sourceRunId,
          skipIfReady: options.skipIfReady,
        });
        if (result) updated += 1;
        else skipped += 1;
      });
    }

    return { updated, skipped };
  }

  private async backfillSymbolTradingValue(input: {
    provider: string;
    marketEnv: 'mock' | 'production';
    symbol: string;
    stockId: number;
    tradeDate: string;
    sourceRunId: string;
    skipIfReady?: boolean;
  }): Promise<boolean> {
    const fromIso = `${input.tradeDate}T00:00:00.000Z`;
    const toIso = `${input.tradeDate}T06:20:00.000Z`;
    const candles = await this.vendor.fetchChartCandles({
      requestId: input.sourceRunId,
      symbol: input.symbol,
      marketEnv: input.marketEnv,
      intervalType: '1m',
      chartMarket: input.marketEnv === 'production' ? 'AL' : 'KRW',
      fromIso,
      toIso,
      baseDt: input.tradeDate.replaceAll('-', ''),
      acceptFromIso: fromIso,
      acceptToIso: toIso,
      priority: this.config.priority,
    });
    const values = new Map<string, number>();
    for (const candle of candles) {
      if (typeof candle.tradingValue === 'number' && Number.isFinite(candle.tradingValue)) {
        values.set(new Date(candle.bucketStart).toISOString(), candle.tradingValue);
      }
    }
    if (values.size === 0) {
      this.logger.warn(`tradingValue backfill skipped: no tradingValue fields in ka10080 ${input.symbol}/${input.tradeDate}`);
      return false;
    }

    const partitionKey = input.tradeDate;
    const key = chartArchiveS3Key({
      prefix: this.config.prefix,
      provider: input.provider,
      marketEnv: input.marketEnv,
      market: 'kr',
      timeframe: '1m',
      partitionKey,
      symbol: input.symbol,
    });

    let changed = false;
    await this.withPartitionLock(input, '1m', partitionKey, async () => {
      const existing = this.config.dryRun ? [] : await this.s3.getRows(key);
      if (existing.length === 0) return;
      const merged = existing.map((row) => {
        const tradingValue = values.get(row.bucketStartUtc);
        if (tradingValue === undefined || row.tradingValue === tradingValue) return row;
        changed = true;
        return { ...row, tradingValue, dataRevision: row.dataRevision + 1 };
      });
      if (!changed) return;
      const expected = this.calendar.expectedOneMinuteRows(input.tradeDate);
      const status = merged.length >= expected ? 'READY' : 'PARTIAL';
      await this.writePartition(input, '1m', partitionKey, merged, expected, status);
      if (status === 'READY') await this.writeAggregatePartitions(input, merged);
    });
    return changed;
  }

  private async writeNoTradeManifests(
    marketEnv: 'mock' | 'production',
    tradeDate: string,
    sourceRunId: string,
    stocks: Awaited<ReturnType<StockRepository['findActiveListedStocks']>>,
    tasks: readonly ChartArchiveTaskKey[],
  ): Promise<void> {
    for (const [index, stock] of stocks.entries()) {
      const task = tasks[index];
      try {
        if (!this.config.dryRun) {
          const state = await this.tasks.markRunning(task, this.config.taskMaxAttempts);
          if (state === 'SKIPPED') continue;
        }
        await this.writePartition(
          {
            provider: 'kiwoom',
            marketEnv,
            symbol: stock.symbol,
            stockId: Number(stock.id),
            tradeDate,
            sourceRunId,
          },
          '1m',
          tradeDate,
          [],
          0,
          'NO_TRADE',
        );
        if (!this.config.dryRun) await this.tasks.markReady(task);
      } catch (err) {
        if (!this.config.dryRun) await this.tasks.markFailed(task, err);
        await this.raiseArchiveAlert({
          severity: 'warning',
          subject: `chart archive NO_TRADE task failed ${stock.symbol}/${tradeDate}`,
          message: err instanceof Error ? err.message : String(err),
          metadata: { tradeDate, sourceRunId, symbol: stock.symbol, marketEnv },
        });
        this.logger.warn(
          `chart archive NO_TRADE task failed ${stock.symbol}/${tradeDate}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
  }

  private async writePartition(
    input: {
      provider: string;
      marketEnv: 'mock' | 'production';
      symbol: string;
      stockId: number | null;
      tradeDate: string;
      sourceRunId: string;
    },
    timeframe: '1m' | '1h' | '1d',
    partitionKey: string,
    rows: readonly ArchivedCandleRow[],
    expectedRowCount: number,
    status: ChartArchiveManifestRecord['status'],
  ): Promise<void> {
    const key = chartArchiveS3Key({
      prefix: this.config.prefix,
      provider: input.provider,
      marketEnv: input.marketEnv,
      market: 'kr',
      timeframe,
      partitionKey,
      symbol: input.symbol,
    });
    const sidecarKey = sidecarManifestS3Key(key);
    if (this.config.dryRun) {
      this.logger.log(
        `chart archive dry-run ${input.symbol} ${timeframe}/${partitionKey} status=${status} rows=${rows.length}/${expectedRowCount}`,
      );
      return;
    }
    const checksums =
      status === 'NO_TRADE'
        ? { objectChecksum: null, contentChecksum: null }
        : await this.s3.putRows(key, rows);
    const now = new Date().toISOString();
    const manifest = await this.manifests.upsertManifest({
      provider: input.provider,
      marketEnv: input.marketEnv,
      market: 'kr',
      symbol: input.symbol,
      stockId: input.stockId,
      timeframe,
      partitionKey,
      status,
      s3Key: status === 'NO_TRADE' ? null : key,
      sidecarS3Key: status === 'NO_TRADE' ? null : sidecarKey,
      expectedRowCount,
      actualRowCount: rows.length,
      coverageRatio: expectedRowCount === 0 ? 1.0 : rows.length / expectedRowCount,
      objectChecksum: checksums.objectChecksum,
      contentChecksum: checksums.contentChecksum,
      sourceChecksum: rows.length > 0 ? sha256Hex(JSON.stringify(rows)) : null,
      sourceRunId: input.sourceRunId,
      schemaVersion: 1,
      archivedAt: now,
      lastModifiedAt: now,
      errorMessage: null,
    });
    if (status !== 'NO_TRADE') await this.s3.putSidecar(sidecarKey, manifest);
    await this.manifests.publishManifestChanged({
      provider: input.provider,
      marketEnv: input.marketEnv,
      symbol: input.symbol,
      timeframe,
      partitionKey,
      status: manifest.status,
      dataRevision: manifest.dataRevision,
      archivedAt: manifest.archivedAt,
    });
  }

  private async writeAggregatePartitions(
    input: {
      provider: string;
      marketEnv: 'mock' | 'production';
      symbol: string;
      stockId: number | null;
      tradeDate: string;
      sourceRunId: string;
    },
    oneMinuteRows: readonly ArchivedCandleRow[],
    derivedTimeframes: readonly ('1h' | '1d')[] = ['1h', '1d'],
  ): Promise<void> {
    if (oneMinuteRows.length === 0) return;
    const maxTradeDate = maxKstTradeDate(oneMinuteRows, input.tradeDate);
    if (derivedTimeframes.includes('1h')) {
      const hourlyRows = deriveHourlyRows(input, oneMinuteRows);
      await this.writeMergedAggregatePartition(
        input,
        '1h',
        input.tradeDate.slice(0, 7),
        hourlyRows,
        this.calendar.expectedHourlyRowsInMonth(input.tradeDate.slice(0, 7), maxTradeDate),
      );
    }
    if (derivedTimeframes.includes('1d')) {
      const dailyRows = deriveDailyRows(input, oneMinuteRows);
      await this.writeMergedAggregatePartition(
        input,
        '1d',
        input.tradeDate.slice(0, 4),
        dailyRows,
        this.calendar.expectedDailyRowsInYear(input.tradeDate.slice(0, 4), maxTradeDate),
      );
    }
  }

  private async writeMergedAggregatePartition(
    input: {
      provider: string;
      marketEnv: 'mock' | 'production';
      symbol: string;
      stockId: number | null;
      tradeDate: string;
      sourceRunId: string;
    },
    timeframe: '1h' | '1d',
    partitionKey: string,
    rows: readonly ArchivedCandleRow[],
    expectedRowCount: number,
  ): Promise<void> {
    const key = chartArchiveS3Key({
      prefix: this.config.prefix,
      provider: input.provider,
      marketEnv: input.marketEnv,
      market: 'kr',
      timeframe,
      partitionKey,
      symbol: input.symbol,
    });
    await this.withPartitionLock(input, timeframe, partitionKey, async () => {
      const existing = this.config.dryRun ? [] : await this.s3.getRows(key);
      const merged = mergeRows(existing, rows);
      const maxTradeDate = maxKstTradeDate(merged, input.tradeDate);
      const correctedExpected =
        timeframe === '1h'
          ? this.calendar.expectedHourlyRowsInMonth(partitionKey, maxTradeDate)
          : this.calendar.expectedDailyRowsInYear(partitionKey, maxTradeDate);
      const effectiveExpected = Math.max(expectedRowCount, correctedExpected);
      const status = merged.length >= effectiveExpected ? 'READY' : 'PARTIAL';
      await this.writePartition(input, timeframe, partitionKey, merged, effectiveExpected, status);
    });
  }

  private async withPartitionLock(
    input: { provider: string; marketEnv: 'mock' | 'production'; symbol: string },
    timeframe: '1m' | '1h' | '1d',
    partitionKey: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    if (!this.redis) {
      await fn();
      return;
    }
    const owner = randomUUID();
    const key = `worker:chart-archive:rmw:${input.provider}:${input.marketEnv}:${input.symbol}:${timeframe}:${partitionKey}`;
    let acquired: string | null = null;
    for (let attempt = 0; attempt <= this.config.aggregateLockRetryCount; attempt += 1) {
      acquired = await this.redis.set(key, owner, 'EX', this.config.aggregateLockTtlSec, 'NX');
      if (acquired === 'OK') break;
      if (attempt < this.config.aggregateLockRetryCount) {
        await sleep(this.config.aggregateLockRetryDelayMs);
      }
    }
    if (acquired !== 'OK') {
      throw new AggregateLockBusyError(key);
    }
    try {
      await fn();
    } finally {
      await this.redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          key,
          owner,
        )
        .catch((err) =>
          this.logger.warn(`aggregate RMW lock release failed: ${err instanceof Error ? err.message : err}`),
        );
    }
  }

  private async raiseArchiveAlert(input: {
    severity: 'info' | 'warning' | 'critical';
    subject: string;
    message: string;
    metadata?: Record<string, string>;
  }): Promise<void> {
    await this.alerts.raise({
      category: 'chart-archive-failure',
      severity: input.severity,
      subject: input.subject,
      message: input.message,
      metadata: input.metadata,
    });
  }
}

function positiveHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function deriveHourlyRows(
  input: { provider: string; marketEnv: 'mock' | 'production'; symbol: string; stockId: number | null },
  rows: readonly ArchivedCandleRow[],
): ArchivedCandleRow[] {
  const grouped = new Map<string, ArchivedCandleRow[]>();
  for (const row of rows) {
    const date = new Date(row.bucketStartUtc);
    date.setUTCMinutes(0, 0, 0);
    const key = date.toISOString();
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucketStartUtc, bucketRows]) => aggregateRows(input, '1h', bucketStartUtc, bucketRows));
}

function deriveDailyRows(
  input: {
    provider: string;
    marketEnv: 'mock' | 'production';
    symbol: string;
    stockId: number | null;
  },
  rows: readonly ArchivedCandleRow[],
): ArchivedCandleRow[] {
  const grouped = new Map<string, ArchivedCandleRow[]>();
  for (const row of rows) {
    const tradeDate = kstTradeDate(row.bucketStartUtc);
    grouped.set(tradeDate, [...(grouped.get(tradeDate) ?? []), row]);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tradeDate, bucketRows]) => aggregateRows(input, '1d', kstTradeDateStartUtc(tradeDate), bucketRows));
}

function aggregateRows(
  input: { provider: string; marketEnv: 'mock' | 'production'; symbol: string; stockId: number | null },
  timeframe: '1h' | '1d',
  bucketStartUtc: string,
  rows: readonly ArchivedCandleRow[],
): ArchivedCandleRow {
  const sorted = [...rows].sort((a, b) => a.bucketStartUtc.localeCompare(b.bucketStartUtc));
  return {
    provider: input.provider,
    marketEnv: input.marketEnv,
    market: 'kr',
    symbol: input.symbol,
    stockId: input.stockId,
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

function mergeRows(
  existing: readonly ArchivedCandleRow[],
  incoming: readonly ArchivedCandleRow[],
): ArchivedCandleRow[] {
  const byBucket = new Map<string, ArchivedCandleRow>();
  for (const row of existing) byBucket.set(row.bucketStartUtc, row);
  for (const row of incoming) byBucket.set(row.bucketStartUtc, row);
  return [...byBucket.values()].sort((a, b) => a.bucketStartUtc.localeCompare(b.bucketStartUtc));
}

function maxKstTradeDate(rows: readonly ArchivedCandleRow[], fallback: string): string {
  let max = fallback;
  for (const row of rows) {
    const day = kstTradeDate(row.bucketStartUtc);
    if (day > max) max = day;
  }
  return max;
}

function kstTradeDate(bucketStartUtc: string): string {
  return new Date(new Date(bucketStartUtc).getTime() + 9 * 60 * 60_000)
    .toISOString()
    .slice(0, 10);
}

function kstTradeDateStartUtc(tradeDate: string): string {
  return new Date(`${tradeDate}T00:00:00.000+09:00`).toISOString();
}

function stockMasterSyncThreshold(tradeDate: string): Date {
  return new Date(`${tradeDate}T10:00:00.000Z`);
}

function stockMasterReady(
  stats: { activeListedCount: number; syncedAfterThresholdCount: number; maxLastSyncedAt: Date | null },
  threshold: Date,
): boolean {
  if (stats.activeListedCount === 0) return false;
  if (!stats.maxLastSyncedAt || stats.maxLastSyncedAt.getTime() < threshold.getTime()) return false;
  return stats.syncedAfterThresholdCount / stats.activeListedCount >= 0.9;
}

function formatPreflightStats(
  stats: { activeListedCount: number; syncedAfterThresholdCount: number; maxLastSyncedAt: Date | null },
  threshold: Date,
): string {
  const ratio =
    stats.activeListedCount > 0 ? stats.syncedAfterThresholdCount / stats.activeListedCount : 0;
  return `maxLastSyncedAt=${stats.maxLastSyncedAt?.toISOString() ?? 'null'} syncedRatio=${ratio.toFixed(
    4,
  )} activeListed=${stats.activeListedCount} threshold=${threshold.toISOString()}`;
}

class AggregateLockBusyError extends Error {
  constructor(key: string) {
    super(`aggregate RMW lock busy key=${key}`);
    this.name = 'AggregateLockBusyError';
  }
}

async function mapLimit<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const workers = Array.from({ length: Math.max(1, concurrency) }, async (_, workerIndex) => {
    for (let index = workerIndex; index < items.length; index += Math.max(1, concurrency)) {
      await fn(items[index], index);
    }
  });
  await Promise.all(workers);
}

function isInsideKstArchiveWindow(now: Date, startHhmm: string, endHhmm: string): boolean {
  const kst = new Date(now.getTime() + 9 * 60 * 60_000);
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const start = parseHhmmToMinutes(startHhmm);
  const end = parseHhmmToMinutes(endHhmm);
  if (start === end) return true;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

function parseHhmmToMinutes(hhmm: string): number {
  const [hourRaw, minuteRaw] = hhmm.split(':');
  return Number(hourRaw) * 60 + Number(minuteRaw);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
