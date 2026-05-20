import { KiwoomMarketEnv } from '@config/kiwoom.config';
import { dispatchKiwoomFrame, type DispatchContext } from './kiwoom-tick.event-mapper';

describe('dispatchKiwoomFrame', () => {
  const ctx: DispatchContext = {
    marketEnv: KiwoomMarketEnv.Mock,
    receivedAt: new Date('2026-05-12T05:00:00Z'),
  };

  it('ignores control frames (LOGIN/PING)', () => {
    expect(dispatchKiwoomFrame({ trnm: 'LOGIN', return_code: 0 }, ctx)).toEqual([
      { kind: 'ignored', reason: 'LOGIN' },
    ]);
  });

  it('parses a 0B trade tick into a tick payload', () => {
    const frame = {
      trnm: 'REAL',
      data: [
        {
          type: '0B',
          item: '005930',
          values: {
            '20': '140258',
            '10': '+267500',
            '15': '+5',
            '13': '31427283',
          },
        },
      ],
    };

    const results = dispatchKiwoomFrame(frame, ctx);

    expect(results).toHaveLength(1);

    const result = results[0];

    expect(result.kind).toBe('tick');

    if (result.kind !== 'tick') return;

    expect(result.tick.symbol).toBe('005930');

    expect(result.tick.price).toBe(267500);

    expect(result.tick.tradeVolume).toBe(5);

    expect(result.tick.cumulativeVolume).toBe(31427283);

    expect(result.tick.parseWarnings).toEqual([]);
  });

  it('parses a 0J market index frame into an index payload', () => {
    const frame = {
      trnm: 'REAL',
      data: [
        {
          type: '0J',
          item: '001',
          values: {
            '20': '140258',
            '10': '+2743.20',
            '11': '-12.30',
            '12': '-0.45',
            '13': '123456789',
            '14': '987654321000',
          },
        },
      ],
    };

    const results = dispatchKiwoomFrame(frame, ctx);

    expect(results).toHaveLength(1);

    const result = results[0];

    expect(result.kind).toBe('market-index');

    if (result.kind !== 'market-index') return;

    expect(result.marketIndex).toMatchObject({
      provider: 'KIWOOM',
      marketEnv: 'MOCK',
      symbol: 'KOSPI',
      name: 'KOSPI',
      value: 2743.2,
      change: -12.3,
      changePct: -0.45,
      volume: 123456789,
      tradeValue: 987654321000,
    });
  });

  it('flags missing price as a parseWarning instead of failing', () => {
    const frame = {
      trnm: 'REAL',
      data: [{ type: '0B', item: '005930', values: { '20': '140258' } }],
    };

    const results = dispatchKiwoomFrame(frame, ctx);
    const result = results[0];

    expect(result.kind).toBe('tick');

    if (result.kind !== 'tick') return;

    expect(result.tick.parseWarnings).toEqual(
      expect.arrayContaining([
        'missing-price',
        'missing-trade-volume',
        'missing-cumulative-volume',
      ]),
    );

    expect(result.tick.price).toBeNull();
  });

  it('returns dead-letter for unknown realtime types', () => {
    const frame = {
      trnm: 'REAL',
      data: [{ type: '0Z', item: '005930', values: {} }],
    };

    const results = dispatchKiwoomFrame(frame, ctx);

    expect(results[0].kind).toBe('dead-letter');
  });

  it('returns dead-letter when frame is not an object', () => {
    const results = dispatchKiwoomFrame('garbage', ctx);

    expect(results[0].kind).toBe('dead-letter');
  });
});
