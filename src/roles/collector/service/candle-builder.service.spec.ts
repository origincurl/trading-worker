import type { MarketTickPayload } from '@shared/event/market-tick.event';
import { CandleBuilderService } from './candle-builder.service';

function tick(
  overrides: Partial<MarketTickPayload> & { sourceTs: string; price: number; tradeVolume: number },
): MarketTickPayload {
  return {
    provider: 'kiwoom',
    marketEnv: 'mock',
    symbol: '005930',
    market: 'KOSPI',
    receivedAt: overrides.sourceTs,
    priceChange: null,
    changeRate: null,
    cumulativeVolume: null,
    open: null,
    high: null,
    low: null,
    bestBid: null,
    bestAsk: null,
    parseWarnings: [],
    ...overrides,
  };
}

describe('CandleBuilderService', () => {
  let builder: CandleBuilderService;

  beforeEach(() => {
    builder = new CandleBuilderService();
  });

  it('accumulates same-bucket ticks into one open candle', () => {
    const r1 = builder.ingest(
      tick({ sourceTs: '2026-05-12T05:01:10Z', price: 100, tradeVolume: 2 }),
    );
    const r2 = builder.ingest(
      tick({ sourceTs: '2026-05-12T05:01:30Z', price: 110, tradeVolume: 3 }),
    );

    expect(r1.kind).toBe('accepted');

    expect(r2.kind).toBe('accepted');

    if (r2.kind !== 'accepted') return;

    expect(r2.closed).toBeNull();

    expect(r2.current.open).toBe(100);

    expect(r2.current.high).toBe(110);

    expect(r2.current.low).toBe(100);

    expect(r2.current.close).toBe(110);

    expect(r2.current.volume).toBe(5);

    expect(r2.current.tickCount).toBe(2);
  });

  it('closes the previous bucket when a later-bucket tick arrives', () => {
    builder.ingest(tick({ sourceTs: '2026-05-12T05:01:10Z', price: 100, tradeVolume: 1 }));

    const r2 = builder.ingest(
      tick({ sourceTs: '2026-05-12T05:02:05Z', price: 120, tradeVolume: 4 }),
    );

    expect(r2.kind).toBe('accepted');

    if (r2.kind !== 'accepted') return;

    expect(r2.closed).not.toBeNull();

    expect(r2.closed!.close).toBe(100);

    expect(r2.current.open).toBe(120);
  });

  it('rejects price <= 0', () => {
    const r = builder.ingest(tick({ sourceTs: '2026-05-12T05:01:10Z', price: 0, tradeVolume: 1 }));

    expect(r.kind).toBe('rejected');

    if (r.kind === 'rejected') expect(r.reason).toBe('invalid-price');
  });

  it('rejects tradeVolume === 0', () => {
    const r = builder.ingest(
      tick({ sourceTs: '2026-05-12T05:01:10Z', price: 100, tradeVolume: 0 }),
    );

    expect(r.kind).toBe('rejected');

    if (r.kind === 'rejected') expect(r.reason).toBe('invalid-volume');
  });

  it('rejects stale ticks (sourceTs < lastAccepted)', () => {
    builder.ingest(tick({ sourceTs: '2026-05-12T05:01:30Z', price: 100, tradeVolume: 1 }));

    const r = builder.ingest(
      tick({ sourceTs: '2026-05-12T05:01:10Z', price: 100, tradeVolume: 1 }),
    );

    expect(r.kind).toBe('rejected');

    if (r.kind === 'rejected') expect(r.reason).toBe('stale-tick');
  });

  it('flushAll empties in-memory state', () => {
    builder.ingest(tick({ sourceTs: '2026-05-12T05:01:10Z', price: 100, tradeVolume: 1 }));

    const flushed = builder.flushAll();

    expect(flushed).toHaveLength(1);

    expect(builder.openBuckets()).toHaveLength(0);
  });
});
