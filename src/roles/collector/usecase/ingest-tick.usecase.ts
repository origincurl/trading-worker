import { Inject, Injectable } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import {
  dispatchKiwoomFrame,
  type DispatchContext,
  type DispatchResult,
} from '@roles/collector/mapper/kiwoom-tick.event-mapper';
import { DeadLetterService } from '@roles/collector/service/dead-letter.service';
import { MarketIndexSnapshotService } from '@roles/collector/service/market-index-snapshot.service';
import { MarketOrderbookService } from '@roles/collector/service/market-orderbook.service';
import { MarketTickService } from '@roles/collector/service/market-tick.service';
import { RefreshUniverseUsecase } from './refresh-universe.usecase';

interface IngestStats {
  total: number;
  ticks: number;
  orderbooks: number;
  marketIndexes: number;
  ignored: number;
  deadLetters: number;
  parseWarnings: number;
}

@Injectable()
export class IngestTickUsecase {
  private readonly stats: IngestStats = {
    total: 0,
    ticks: 0,
    orderbooks: 0,
    marketIndexes: 0,
    ignored: 0,
    deadLetters: 0,
    parseWarnings: 0,
  };

  constructor(
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    private readonly tickService: MarketTickService,
    private readonly orderbookService: MarketOrderbookService,
    private readonly marketIndexService: MarketIndexSnapshotService,
    private readonly deadLetter: DeadLetterService,
    private readonly refreshUniverse: RefreshUniverseUsecase,
  ) {}

  snapshotStats(): Readonly<IngestStats> {
    return { ...this.stats };
  }

  async execute(rawFrame: unknown, receivedAt: Date = new Date()): Promise<void> {
    this.stats.total += 1;

    const ctx: DispatchContext = { marketEnv: this.kiwoom.marketEnv, receivedAt };
    const results = dispatchKiwoomFrame(rawFrame, ctx);

    for (const result of results) {
      await this.handleResult(result);
    }
  }

  private async handleResult(result: DispatchResult): Promise<void> {
    switch (result.kind) {
      case 'tick':
        this.stats.ticks += 1;
        this.refreshUniverse.recordFrameReceived(result.tick.symbol, new Date(result.tick.receivedAt));

        if (result.tick.parseWarnings.length > 0) {
          this.stats.parseWarnings += 1;

          await this.deadLetter.emit('parse-warning', result.tick.parseWarnings.join(','), {
            realtimeType: '0B',
            symbol: result.tick.symbol,
            receivedAt: new Date(result.tick.receivedAt),
            parseWarnings: result.tick.parseWarnings,
          });
        }

        await this.tickService.recordTick(result.tick);

        return;

      case 'orderbook':
        this.stats.orderbooks += 1;
        this.refreshUniverse.recordFrameReceived(
          result.orderbook.symbol,
          new Date(result.orderbook.receivedAt),
        );

        await this.orderbookService.recordSnapshot(result.orderbook);

        return;

      case 'market-index':
        this.stats.marketIndexes += 1;

        await this.marketIndexService.recordRealtime(result.marketIndex);

        return;

      case 'ignored':
        this.stats.ignored += 1;

        return;

      case 'dead-letter':
        this.stats.deadLetters += 1;

        await this.deadLetter.emit(
          result.realtimeType === null ? 'parse-error' : 'unrecognized-realtime-type',
          result.reason,
          {
            realtimeType: result.realtimeType,
            symbol: result.symbol,
          },
        );

        return;
    }
  }
}
