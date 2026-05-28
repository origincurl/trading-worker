import { NestFactory } from '@nestjs/core';
import { config as loadDotenv } from 'dotenv';
import { randomUUID } from 'crypto';
import { validateEnv } from '../src/config/config.module';
import { ArchiveOpsModule } from '../src/ops/archive-ops.module';
import { ChartArchiveWriterService } from '../src/roles/collector/chart-archive/chart-archive-writer.service';

async function main(): Promise<void> {
  loadDotenv({ path: '.env.local', override: true });
  loadDotenv();

  const args = parseArgs(process.argv.slice(2));
  process.env.CHART_ARCHIVE_ENABLED = 'true';
  process.env.CHART_ARCHIVE_DRY_RUN = args.dryRun ? 'true' : 'false';
  process.env.CHART_ARCHIVE_MARKET_ENVS = args.marketEnv;
  process.env.CHART_ARCHIVE_PRIORITY = args.priority;

  const config = validateEnv(process.env);
  const app = await NestFactory.createApplicationContext(ArchiveOpsModule.register(config), {
    logger: ['log', 'warn', 'error', 'fatal'],
  });
  try {
    const writer = app.get(ChartArchiveWriterService, { strict: false });
    const runId = args.runId ?? randomUUID();
    await writer.archiveTradeDate(args.tradeDate, runId, {
      recoverStranded: false,
      skipPreflight: true,
      enforceWindowPerSymbol: !args.ignoreWindow,
      symbols: [args.symbol],
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      runId,
      symbol: args.symbol,
      tradeDate: args.tradeDate,
      marketEnv: args.marketEnv,
      dryRun: args.dryRun,
      ignoreWindow: args.ignoreWindow,
    }, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

function parseArgs(argv: string[]): {
  symbol: string;
  tradeDate: string;
  marketEnv: 'mock' | 'production';
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  dryRun: boolean;
  ignoreWindow: boolean;
  runId: string | null;
} {
  const map = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) map.set(key, true);
    else {
      map.set(key, next);
      index += 1;
    }
  }
  const symbol = stringArg(map, 'symbol', '005930');
  const tradeDate = stringArg(map, 'trade-date', '2026-05-27');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw new Error('--trade-date must be YYYY-MM-DD');
  const marketEnv = stringArg(map, 'market-env', 'mock').toLowerCase();
  if (marketEnv !== 'mock' && marketEnv !== 'production') throw new Error('--market-env must be mock or production');
  const priority = stringArg(map, 'priority', 'P4').toUpperCase();
  if (!['P1', 'P2', 'P3', 'P4'].includes(priority)) throw new Error('--priority must be P1/P2/P3/P4');
  return {
    symbol,
    tradeDate,
    marketEnv,
    priority: priority as 'P1' | 'P2' | 'P3' | 'P4',
    dryRun: map.has('dry-run'),
    ignoreWindow: map.has('ignore-window'),
    runId: typeof map.get('run-id') === 'string' ? String(map.get('run-id')) : null,
  };
}

function stringArg(map: Map<string, string | boolean>, key: string, fallback: string): string {
  const value = map.get(key);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
