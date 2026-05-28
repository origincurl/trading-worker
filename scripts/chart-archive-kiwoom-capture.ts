import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { config as loadDotenv } from 'dotenv';
import { writeFileSync } from 'fs';
import { ConfigModule, validateEnv, type ValidatedConfig } from '../src/config/config.module';
import { BrokerageModule } from '../src/external/brokerage/brokerage.module';
import { COLLECTOR_BROKERAGE_VENDOR } from '../src/external/brokerage/brokerage.token';
import type { BrokerageVendor } from '../src/external/brokerage/vendor/brokerage.vendor';
import { CryptoModule } from '../src/shared/crypto/crypto.module';
import { PersistenceModule } from '../src/shared/persistence/persistence.module';

interface Args {
  symbol: string;
  tradeDate: string;
  marketEnv: 'mock' | 'production';
  chartMarket: 'KRW' | 'AL' | 'NXT' | 'UNKNOWN';
  out: string | null;
}

async function main(): Promise<void> {
  loadDotenv({ path: '.env.local', override: true });
  loadDotenv();
  process.env.ROLES = 'collector';

  const args = parseArgs(process.argv.slice(2));
  const config = validateEnv(process.env);
  const app = await NestFactory.createApplicationContext(CaptureModule.register(config), {
    logger: ['log', 'warn', 'error', 'fatal'],
  });

  try {
    const vendor = app.get<BrokerageVendor>(COLLECTOR_BROKERAGE_VENDOR, { strict: false });
    const fromIso = `${args.tradeDate}T00:00:00.000Z`;
    const toIso = `${args.tradeDate}T06:20:00.000Z`;
    const rows = await vendor.fetchChartCandles({
      requestId: `chart-archive-capture-${args.marketEnv}-${args.symbol}-${args.tradeDate}`,
      symbol: args.symbol,
      marketEnv: args.marketEnv,
      chartMarket: args.chartMarket,
      intervalType: '1m',
      fromIso,
      toIso,
      baseDt: args.tradeDate.replaceAll('-', ''),
      acceptFromIso: fromIso,
      acceptToIso: toIso,
      priority: 'P4',
    });
    const tradingValueRows = rows.filter((row) => typeof row.tradingValue === 'number');
    const report = {
      ok: true,
      symbol: args.symbol,
      tradeDate: args.tradeDate,
      marketEnv: args.marketEnv,
      chartMarket: args.chartMarket,
      rowCount: rows.length,
      firstBucketStart: rows[0]?.bucketStart ?? null,
      lastBucketStart: rows[rows.length - 1]?.bucketStart ?? null,
      tradingValueRowCount: tradingValueRows.length,
      tradingValueCoverage: rows.length === 0 ? 0 : tradingValueRows.length / rows.length,
      hasTradingValue: tradingValueRows.length > 0,
      sample: rows.slice(0, 5).map((row) => ({
        bucketStart: row.bucketStart,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        tradingValue: row.tradingValue ?? null,
      })),
    };
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (args.out) writeFileSync(args.out, text, 'utf8');
    process.stdout.write(text);
    if (!report.hasTradingValue) process.exitCode = 2;
  } finally {
    await app.close();
  }
}

@Module({})
class CaptureModule {
  static register(config: ValidatedConfig) {
    return {
      module: CaptureModule,
      imports: [
        ConfigModule.register(config),
        PersistenceModule.register(config.persistence),
        CryptoModule,
        BrokerageModule,
      ],
    };
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
  const symbol = required(map, 'symbol');
  const tradeDate = required(map, 'trade-date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw new Error('--trade-date must be YYYY-MM-DD');
  const marketEnv = String(map.get('market-env') ?? 'mock').toLowerCase();
  if (marketEnv !== 'mock' && marketEnv !== 'production') throw new Error('--market-env must be mock or production');
  const chartMarket = String(map.get('chart-market') ?? (marketEnv === 'production' ? 'AL' : 'KRW')).toUpperCase();
  if (!['KRW', 'AL', 'NXT', 'UNKNOWN'].includes(chartMarket)) {
    throw new Error('--chart-market must be KRW, AL, NXT, or UNKNOWN');
  }
  return {
    symbol,
    tradeDate,
    marketEnv,
    chartMarket: chartMarket as Args['chartMarket'],
    out: typeof map.get('out') === 'string' ? String(map.get('out')) : null,
  };
}

function required(map: Map<string, string | boolean>, key: string): string {
  const value = map.get(key);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`usage: npm run chart:kiwoom-capture -- --symbol 005930 --trade-date YYYY-MM-DD [--market-env mock|production] [--out capture.json]`);
  }
  return value.trim();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
