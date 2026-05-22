import { KiwoomBrokerageVendor } from './kiwoom-brokerage.vendor';
import type { KiwoomRequestOptions } from './kiwoom.api-client';
import type { KiwoomWsMessageHandler } from './kiwoom-ws.client';

describe('KiwoomBrokerageVendor.fetchChartCandles', () => {
  function makeVendor(response: unknown, requests: Array<KiwoomRequestOptions<unknown>>) {
    return new KiwoomBrokerageVendor({
      profile: 'collector',
      apiClient: {
        request: jest.fn(async (options: KiwoomRequestOptions<unknown>) => {
          requests.push(options);

          return response;
        }),
      } as never,
      wsClient: {} as never,
      tokenSupplier: async () => 'token',
    });
  }

  it('maps Kiwoom minute candle timestamps from KST to UTC buckets', async () => {
    const requests: Array<KiwoomRequestOptions<unknown>> = [];
    const vendor = makeVendor(
      {
        stk_min_pole_chart_qry: [
          {
            cntr_tm: '20260520090000',
            open_pric: '-274000',
            high_pric: '274500',
            low_pric: '-273500',
            cur_prc: '-274250',
            trde_qty: '1200',
          },
          {
            cntr_tm: '20260520090100',
            open_pric: '274250',
            high_pric: '274750',
            low_pric: '274000',
            cur_prc: '274500',
            trde_qty: '800',
          },
        ],
      },
      requests,
    );

    const candles = await vendor.fetchChartCandles({
      symbol: '005930',
      marketEnv: 'mock',
      chartMarket: 'KRW',
      intervalType: '1m',
      fromIso: '2026-05-20T00:00:00.000Z',
      toIso: '2026-05-20T00:02:00.000Z',
    });

    expect(requests[0]?.body).toEqual({
      stk_cd: '005930',
      base_dt: '20260520',
      tic_scope: '1',
      upd_stkpc_tp: '1',
    });
    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({
      bucketStart: '2026-05-20T00:00:00.000Z',
      bucketEnd: '2026-05-20T00:01:00.000Z',
      open: 274000,
      low: 273500,
      close: 274250,
      dataSource: 'catchup',
      chartSource: 'broker_chart_REST',
      chartMarket: 'KRW',
      volume: 1200,
    });
    expect(candles[1]?.bucketStart).toBe('2026-05-20T00:01:00.000Z');
  });

  it('maps HHmmss minute candle timestamps using base_dt as the KST date', async () => {
    const requests: Array<KiwoomRequestOptions<unknown>> = [];
    const vendor = makeVendor(
      {
        stk_min_pole_chart_qry: [
          {
            cntr_tm: '090000',
            open_pric: '-274000',
            high_pric: '274500',
            low_pric: '273500',
            cur_prc: '274250',
            trde_qty: '1200',
          },
        ],
      },
      requests,
    );

    const candles = await vendor.fetchChartCandles({
      symbol: '005930',
      marketEnv: 'mock',
      chartMarket: 'KRW',
      intervalType: '1m',
      fromIso: '2026-05-20T00:00:00.000Z',
      toIso: '2026-05-20T00:01:00.000Z',
    });

    expect(candles).toHaveLength(1);
    expect(candles[0]?.bucketStart).toBe('2026-05-20T00:00:00.000Z');
  });

  it('maps daily candle dates from KST midnight to UTC buckets', async () => {
    const requests: Array<KiwoomRequestOptions<unknown>> = [];
    const vendor = makeVendor(
      {
        stk_dt_pole_chart_qry: [
          {
            dt: '20260520',
            open_pric: '-274000',
            high_pric: '275000',
            low_pric: '-273000',
            cur_prc: '-274500',
            trde_qty: '1200',
          },
        ],
      },
      requests,
    );

    const candles = await vendor.fetchChartCandles({
      symbol: '005930',
      marketEnv: 'mock',
      chartMarket: 'KRW',
      intervalType: '1d',
      fromIso: '2026-05-19T15:00:00.000Z',
      toIso: '2026-05-20T15:00:00.000Z',
    });

    expect(requests[0]?.body).toEqual({
      stk_cd: '005930',
      base_dt: '20260520',
      upd_stkpc_tp: '1',
    });
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({
      bucketStart: '2026-05-19T15:00:00.000Z',
      open: 274000,
      low: 273000,
      close: 274500,
    });
  });
});

describe('KiwoomBrokerageVendor.connectMarketDataStream', () => {
  it('invalidates and retries WS LOGIN once when the first token is stale', async () => {
    const sentMessages: object[] = [];
    const wsMessages: KiwoomWsMessageHandler[] = [];
    const invalidate = jest.fn();
    const tokenSupplier = jest
      .fn()
      .mockResolvedValueOnce({
        token: 'stale-token',
        credential: { kind: 'collector', credentialId: 7 },
        invalidate,
      })
      .mockResolvedValueOnce({
        token: 'fresh-token',
        credential: { kind: 'collector', credentialId: 7 },
        invalidate,
      });
    const collectorRuntimeState = {
      markSuccess: jest.fn(async () => undefined),
      markAuthFailed: jest.fn(async () => undefined),
      markWsLimited: jest.fn(async () => undefined),
    };
    const loginResponses = [
      {
        trnm: 'LOGIN',
        return_code: 8005,
        return_msg: 'Token이 유효하지 않습니다',
      },
      {
        trnm: 'LOGIN',
        return_code: 0,
        return_msg: 'OK',
      },
    ];
    const wsClient = {
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      isConnected: jest.fn(() => true),
      onClose: jest.fn(),
      onMessage: jest.fn((handler: KiwoomWsMessageHandler) => {
        wsMessages.push(handler);

        return () => {
          const index = wsMessages.indexOf(handler);
          if (index >= 0) wsMessages.splice(index, 1);
        };
      }),
      send: jest.fn(async (message: object) => {
        sentMessages.push(message);

        if ((message as { trnm?: unknown }).trnm === 'LOGIN') {
          const response = loginResponses.shift();
          if (response) {
            for (const handler of [...wsMessages]) {
              handler(response, JSON.stringify(response));
            }
          }
        }
      }),
    };
    const vendor = new KiwoomBrokerageVendor({
      profile: 'collector',
      apiClient: {} as never,
      wsClient: wsClient as never,
      tokenSupplier,
      collectorRuntimeState: collectorRuntimeState as never,
      postLoginDelayMs: 0,
    });

    await vendor.connectMarketDataStream(jest.fn());

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(tokenSupplier).toHaveBeenCalledTimes(2);
    expect(wsClient.send).toHaveBeenCalledTimes(2);
    expect(sentMessages).toEqual([
      { trnm: 'LOGIN', token: 'stale-token' },
      { trnm: 'LOGIN', token: 'fresh-token' },
    ]);
    expect(collectorRuntimeState.markAuthFailed).not.toHaveBeenCalled();
    expect(collectorRuntimeState.markWsLimited).not.toHaveBeenCalled();
    expect(collectorRuntimeState.markSuccess).toHaveBeenCalledWith({
      credentialId: 7,
      source: 'WS',
    });
    expect(vendor.isMarketDataStreamConnected()).toBe(true);
  });
});
