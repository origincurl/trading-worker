import { KiwoomApiClient, type KiwoomTokenResult } from './kiwoom.api-client';

describe('KiwoomApiClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;

    jest.restoreAllMocks();
  });

  it('invalidates the cached token and retries once when Kiwoom rejects the access token', async () => {
    const invalidate = jest.fn();
    const tokenSupplier = jest
      .fn<Promise<KiwoomTokenResult>, []>()
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
    const markSuccess = jest.fn();
    const markAuthFailed = jest.fn();
    const fetchMock = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            return_code: 3,
            return_msg: '인증에 실패했습니다[8005:Token이 유효하지 않습니다]',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ return_code: 0, output: [{ ok: true }] }), {
          status: 200,
        }),
      );

    global.fetch = fetchMock;

    const client = new KiwoomApiClient({
      profile: 'collector',
      restUrl: 'https://mockapi.kiwoom.example',
      tokenSupplier,
      rateLimiter: { run: (fn) => fn() } as never,
      collectorRuntimeState: {
        markSuccess,
        markAuthFailed,
      } as never,
    });

    await expect(
      client.request({
        apiId: 'ka10080',
        endpointPath: '/api/dostk/chart',
        body: { stk_cd: '005930' },
      }),
    ).resolves.toEqual({ return_code: 0, output: [{ ok: true }] });

    expect(invalidate).toHaveBeenCalledTimes(1);

    expect(tokenSupplier).toHaveBeenCalledTimes(2);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer stale-token',
    });

    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer fresh-token',
    });

    expect(markAuthFailed).not.toHaveBeenCalled();

    expect(markSuccess).toHaveBeenCalledWith({ credentialId: 7, source: 'REST' });
  });
});
