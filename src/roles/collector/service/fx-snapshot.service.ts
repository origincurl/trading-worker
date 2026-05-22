import { Inject, Injectable, Logger } from '@nestjs/common';
import { COLLECTOR_CONFIG, type CollectorConfig } from '@config/collector.config';
import { MarketSnapshotWriter } from '@shared/cache/market-snapshot.writer';

const DEFAULT_BASE = 'USD';
const DEFAULT_QUOTE = 'KRW';
const FETCH_TIMEOUT_MS = 10_000;

type MoneyConvertLatestResponse = {
  base?: string;
  date?: string;
  updated?: string;
  rates?: Record<string, number>;
};

@Injectable()
export class FxSnapshotService {
  private readonly logger = new Logger(FxSnapshotService.name);

  private lastRate: number | null = null;

  constructor(
    @Inject(COLLECTOR_CONFIG) private readonly config: CollectorConfig,
    private readonly writer: MarketSnapshotWriter,
  ) {}

  async refresh(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(this.config.fxLatestUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`moneyconvert HTTP ${response.status}`);
      }

      const parsed = (await response.json()) as MoneyConvertLatestResponse;
      const rate = parsed.rates?.[DEFAULT_QUOTE];

      if (!Number.isFinite(rate)) {
        throw new Error(`moneyconvert response missing ${DEFAULT_QUOTE} rate`);
      }

      const numericRate = Number(rate);
      const fetchedAt = new Date().toISOString();
      const change = this.lastRate === null ? null : numericRate - this.lastRate;
      const changePct =
        this.lastRate === null || this.lastRate === 0
          ? null
          : ((change ?? 0) / this.lastRate) * 100;

      await this.writer.writeFx({
        pair: `${DEFAULT_BASE}${DEFAULT_QUOTE}`,
        base: DEFAULT_BASE,
        quote: DEFAULT_QUOTE,
        rate: numericRate,
        change,
        changePct,
        fetchedAt,
        source: 'moneyconvert',
      });

      this.lastRate = numericRate;
      this.logger.debug(`fx snapshot refreshed USD/KRW=${numericRate}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
