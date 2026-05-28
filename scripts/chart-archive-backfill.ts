import { NestFactory } from '@nestjs/core';
import { config as loadDotenv } from 'dotenv';
import { randomUUID } from 'crypto';
import { appendFileSync, existsSync, readFileSync } from 'fs';
import { validateEnv } from '../src/config/config.module';
import { ArchiveOpsModule } from '../src/ops/archive-ops.module';
import { ChartArchiveWriterService } from '../src/roles/collector/chart-archive/chart-archive-writer.service';

interface Args {
  from: string;
  to: string;
  dryRun: boolean;
  confirmLarge: boolean;
  symbols: string[];
  resume: boolean;
  overwrite: boolean;
  timeframes: string[];
  field: string | null;
  failedFile: string;
  priority: string;
  maxDaysPerRun: number;
  budgetSymbolsPerDay: number | null;
  collectorKey: string | null;
  ignoreWindow: boolean;
  requireSymbols: boolean;
  fromFailedFile: string | null;
}

async function main(): Promise<void> {
  loadDotenv({ path: '.env.local', override: true });
  loadDotenv();

  const args = parseArgs(process.argv.slice(2));
  const dates = enumerateDates(args.from, args.to);
  if (dates.length > 20 && !args.confirmLarge && !args.dryRun) {
    throw new Error('large backfill requires --confirm-large or --dry-run');
  }
  if (args.field && args.field !== 'tradingValue') {
    throw new Error(`unsupported --field ${args.field}`);
  }
  const unsupportedTimeframes = args.timeframes.filter((timeframe) => !['1m', '1h', '1d'].includes(timeframe));
  if (unsupportedTimeframes.length > 0) {
    throw new Error(`unsupported --timeframes ${unsupportedTimeframes.join(',')}; canonical archive supports 1m,1h,1d`);
  }
  if (args.dryRun) process.env.CHART_ARCHIVE_DRY_RUN = 'true';
  process.env.CHART_ARCHIVE_PRIORITY = args.priority;
  if (!args.dryRun && !args.ignoreWindow && !isInsideKstArchiveWindow(new Date())) {
    throw new Error('backfill is outside archive window (20:00 <= KST < 06:00); pass --ignore-window to override');
  }

  const config = validateEnv(process.env);
  const app = await NestFactory.createApplicationContext(ArchiveOpsModule.register(config), {
    logger: ['log', 'warn', 'error', 'fatal'],
  });

  try {
    const writer = app.get(ChartArchiveWriterService, { strict: false });
    const selectedDates = dates.slice(0, args.maxDaysPerRun);
    const selectedSymbols = args.symbols;
    if (args.requireSymbols && selectedSymbols.length === 0) {
      throw new Error('historical backfill requires explicit --symbols when --require-symbols is set');
    }
    const symbolShard = parseCollectorKey(args.collectorKey);
    const writeOneMinute = args.timeframes.includes('1m');
    const writeDerived = args.timeframes.includes('1h') || args.timeframes.includes('1d');
    const derivedTimeframes = args.timeframes.filter(
      (timeframe): timeframe is '1h' | '1d' => timeframe === '1h' || timeframe === '1d',
    );
    for (const tradeDate of selectedDates) {
      const runId = randomUUID();
      try {
        if (args.field === 'tradingValue') {
          if (!writeOneMinute) {
            throw new Error('--field tradingValue requires --timeframes to include 1m');
          }
          await writer.backfillTradingValueForDate(tradeDate, runId, {
            symbols: selectedSymbols,
            symbolShard,
            budgetSymbolsPerDay: args.budgetSymbolsPerDay ?? undefined,
            skipIfReady: args.resume && !args.overwrite,
          });
        } else {
          if (writeOneMinute) {
            await writer.archiveTradeDate(tradeDate, runId, {
              recoverStranded: false,
              skipPreflight: true,
              symbols: selectedSymbols,
              symbolShard,
              budgetSymbolsPerDay: args.budgetSymbolsPerDay ?? undefined,
              enforceWindowPerSymbol: false,
              skipIfReady: args.resume && !args.overwrite,
              writeDerived,
              derivedTimeframes,
            });
          } else if (writeDerived) {
            await writer.rebuildDerivedForDate(tradeDate, runId, {
              symbols: selectedSymbols,
              symbolShard,
              budgetSymbolsPerDay: args.budgetSymbolsPerDay ?? undefined,
              derivedTimeframes,
            });
          }
        }
      } catch (err) {
        const record = {
          tradeDate,
          runId,
          symbols: selectedSymbols.length > 0 ? selectedSymbols : 'ALL',
          collectorKey: args.collectorKey,
          field: args.field,
          priority: args.priority,
          error: err instanceof Error ? err.message : String(err),
          failedAt: new Date().toISOString(),
        };
        appendFileSync(args.failedFile, `${JSON.stringify(record)}\n`, 'utf8');
        if (!args.resume) throw err;
      }
    }
  } finally {
    await app.close();
  }
}

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) map.set(key, true);
    else {
      map.set(key, next);
      i += 1;
    }
  }
  const from = map.get('from');
  const to = map.get('to');
  if (typeof from !== 'string' || typeof to !== 'string') {
    const failed = map.get('from-failed-file');
    if (typeof failed !== 'string') {
      throw new Error('usage: npm run chart:backfill -- --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run] [--confirm-large]');
    }
  }
  const failedFileInput = typeof map.get('from-failed-file') === 'string' ? String(map.get('from-failed-file')) : null;
  const failedRecords = failedFileInput ? readFailedRecords(failedFileInput) : [];
  const failedDates = failedRecords.map((record) => record.tradeDate);
  const explicitSymbols = parseCsv(map.get('symbols'));
  const failedSymbols = unique(failedRecords.flatMap((record) => record.symbols));
  return {
    from: typeof from === 'string' ? from : minString(failedDates),
    to: typeof to === 'string' ? to : maxString(failedDates),
    dryRun: map.has('dry-run'),
    confirmLarge: map.has('confirm-large'),
    symbols: explicitSymbols.length > 0 ? explicitSymbols : failedSymbols,
    resume: map.has('resume'),
    overwrite: map.has('overwrite'),
    timeframes: parseCsv(map.get('timeframes'), ['1m', '1h', '1d']),
    field: typeof map.get('field') === 'string' ? String(map.get('field')) : null,
    failedFile: typeof map.get('failed-file') === 'string' ? String(map.get('failed-file')) : 'backfill-failed.jsonl',
    priority: typeof map.get('priority') === 'string' ? String(map.get('priority')) : 'P4',
    maxDaysPerRun: parsePositiveInt(map.get('max-days-per-run'), Number.POSITIVE_INFINITY),
    budgetSymbolsPerDay:
      typeof map.get('budget-symbols-per-day') === 'string'
        ? parsePositiveInt(map.get('budget-symbols-per-day'), Number.POSITIVE_INFINITY)
        : null,
    collectorKey: typeof map.get('collector-key') === 'string' ? String(map.get('collector-key')) : null,
    ignoreWindow: map.has('ignore-window'),
    requireSymbols: map.has('require-symbols'),
    fromFailedFile: failedFileInput,
  };
}

function parseCsv(raw: string | boolean | undefined, fallback: string[] = []): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const value = raw.trim();
  if (value.toUpperCase() === 'ALL') return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function parsePositiveInt(raw: string | boolean | undefined, fallback: number): number {
  if (typeof raw !== 'string') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCollectorKey(raw: string | null): { index: number; total: number } | undefined {
  if (!raw) return undefined;
  const [index, total] = raw.split('/').map((item) => Number.parseInt(item, 10));
  if (!Number.isInteger(index) || !Number.isInteger(total) || total <= 0 || index < 0 || index >= total) {
    throw new Error('--collector-key must be formatted as index/total, e.g. 0/4');
  }
  return { index, total };
}

function readFailedRecords(file: string): Array<{ tradeDate: string; symbols: string[] }> {
  if (!existsSync(file)) throw new Error(`failed file not found: ${file}`);
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { tradeDate?: unknown; symbols?: unknown })
    .filter((record): record is { tradeDate: string; symbols?: unknown } => typeof record.tradeDate === 'string')
    .map((record) => ({
      tradeDate: record.tradeDate,
      symbols: Array.isArray(record.symbols) ? record.symbols.filter((item): item is string => typeof item === 'string') : [],
    }));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function minString(values: string[]): string {
  if (values.length === 0) throw new Error('--from/--to or --from-failed-file with tradeDate records is required');
  return [...values].sort()[0];
}

function maxString(values: string[]): string {
  if (values.length === 0) throw new Error('--from/--to or --from-failed-file with tradeDate records is required');
  return [...values].sort()[values.length - 1];
}

function isInsideKstArchiveWindow(now: Date): boolean {
  const kst = new Date(now.getTime() + 9 * 60 * 60_000);
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return minutes >= 20 * 60 || minutes < 6 * 60;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
