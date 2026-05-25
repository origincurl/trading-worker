import { Logger } from '@nestjs/common';
import { DomainError, IntegrationError, NotImplementedError } from '@common/error/domain.error';
import { parseSignedNumber } from '@common/util/kiwoom-number-parse';
import type {
  CandleChartMarket,
  MarketCandleClosedPayload,
} from '@shared/event/market-candle-closed.event';
import {
  MARKET_INDEX_CODES,
  MARKET_INDEX_NAMES,
  type MarketIndexSymbol,
} from '@shared/event/market-index.event';
import type { BrokerageVendorProfile } from '../../brokerage.token';
import type {
  BrokerageVendor,
  CancelOrderInput,
  FetchChartCandlesInput,
  FetchMarketIndexSnapshotsInput,
  GetAccountBalanceInput,
  GetPositionsInput,
  GetStockMasterListInput,
  MarketIndexSnapshot,
  MarketDataFrameHandler,
  MarketDataFrameKind,
  MarketDataSubscription,
  ModifyOrderInput,
  PlaceOrderInput,
  StockMasterEntry,
  SubscribeMarketDataInput,
  UnsubscribeMarketDataInput,
} from '../../vendor/brokerage.vendor';
import type { AccountBalanceModel, PositionModel } from '../../model/account.model';
import type { OrderAckModel, OrderSide, OrderType } from '../../model/order.model';
import type { CancelOrderRequestContract } from './contract/request/cancel-order.request';
import type { FetchChartCandlesRequestContract } from './contract/request/fetch-chart-candles.request';
import type { GetAccountBalanceRequestContract } from './contract/request/get-account-balance.request';
import type { GetPositionsRequestContract } from './contract/request/get-positions.request';
import type { GetStockMasterListRequestContract } from './contract/request/get-stock-master-list.request';
import type { ModifyOrderRequestContract } from './contract/request/modify-order.request';
import type { PlaceOrderRequestContract } from './contract/request/place-order.request';
import type { CancelOrderResponseContract } from './contract/response/cancel-order.response';
import type {
  FetchChartCandlesResponseContract,
  KiwoomChartCandleRowContract,
} from './contract/response/fetch-chart-candles.response';
import type { GetAccountBalanceResponseContract } from './contract/response/get-account-balance.response';
import type { GetPositionsResponseContract } from './contract/response/get-positions.response';
import type {
  GetStockMasterListResponseContract,
  KiwoomStockMasterRowContract,
} from './contract/response/get-stock-master-list.response';
import type { ModifyOrderResponseContract } from './contract/response/modify-order.response';
import type { PlaceOrderResponseContract } from './contract/response/place-order.response';
import {
  normalizeTokenResult,
  type KiwoomApiClient,
  type KiwoomTokenResult,
  type KiwoomTokenSupplier,
} from './kiwoom.api-client';
import type { KiwoomWsClient } from './kiwoom-ws.client';
import type {
  CredentialUsageContext,
  CredentialUsageService,
} from '../../credential/credential-usage.service';
import type { CollectorCredentialLimitRepository } from '@shared/persistence/collector-credential/collector-credential-limit.repository';

export interface KiwoomBrokerageVendorOptions {
  readonly profile: BrokerageVendorProfile;
  readonly apiClient: KiwoomApiClient;
  readonly wsClient: KiwoomWsClient;
  // Same supplier the apiClient/wsClient use. Held on the gateway so the
  // admin credential probe can exercise the live /oauth2/token path
  // without needing a back-reference into the token service singleton.
  readonly tokenSupplier: KiwoomTokenSupplier;
  readonly accountTokenSupplier?: (accountId: number) => Promise<KiwoomTokenResult>;
  readonly usage?: CredentialUsageService;
  readonly collectorRuntimeState?: CollectorCredentialLimitRepository;
  // Used by AccessTokenCacheService.invalidate when LOGIN keeps failing.
  // The supplier closure captures the credentialId — we surface a hook
  // here so the gateway can drop a cached token on auth rejection.
  readonly invalidateToken?: () => void;
  readonly loginAckTimeoutMs?: number;
  readonly postLoginDelayMs?: number;
  // Phase 6.8: backoff parameters for the gateway-level reconnect loop.
  // enabled=false reverts to Phase 6 (close = give up).
  readonly reconnect?: {
    readonly enabled: boolean;
    readonly initialDelayMs?: number;
    readonly maxDelayMs?: number;
    readonly maxAttempts?: number;
  };
}

const DEFAULT_LOGIN_ACK_TIMEOUT_MS = 5_000;
const DEFAULT_POST_LOGIN_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_RECONNECT_MAX_ATTEMPTS = 0; // 0 = unlimited
const KST_OFFSET_MS = 9 * 3_600_000;

type KiwoomMarketIndexCurrentResponseContract = Record<string, unknown>;

// Endpoint category paths. Kiwoom REST groups apiIds by domain category.
// TODO(kiwoom-spec): verify each category against current Kiwoom REST docs.
const PATH_ORDER = '/api/dostk/ordr';
const PATH_ACCOUNT = '/api/dostk/acnt';
const PATH_CHART = '/api/dostk/chart';
const PATH_SECTOR = '/api/dostk/sect';
const PATH_STOCK_INFO = '/api/dostk/stkinfo';

// apiId catalogue. Public Kiwoom REST values; flagged with TODO comments
// where the mapping is uncertain.
const APIID_PLACE_BUY = 'kt10000';
const APIID_PLACE_SELL = 'kt10001';
const APIID_MODIFY = 'kt10002';
const APIID_CANCEL = 'kt10003';
const APIID_ACCOUNT_BALANCE = 'kt00001';
const APIID_POSITIONS = 'kt00018';
const APIID_CHART_MINUTE = 'ka10080';
const APIID_CHART_DAILY = 'ka10081';
const APIID_STOCK_MASTER = 'ka10099';
const APIID_INDEX_CURRENT = 'ka20001';

// Phase 6 market-data stream (collector-only) + Phase 6.8 auto-reconnect.
// Phase 8: REST order paths and chart/master read paths wired against
// KiwoomApiClient.request.
export class KiwoomBrokerageVendor implements BrokerageVendor {
  private readonly logger: Logger;

  private readonly subscriptions = new Map<string, Set<MarketDataFrameKind>>();

  private loggedIn = false;

  private userInitiatedDisconnect = false;

  private frameHandler: MarketDataFrameHandler | null = null;

  private reconnectAttempts = 0;

  private consecutiveLoginFailures = 0;

  private loginHalted = false;

  private reconnecting = false;

  private activeWsCredential: CredentialUsageContext | null = null;

  private lastSystemCloseReason: string | null = null;

  constructor(private readonly opts: KiwoomBrokerageVendorOptions) {
    this.logger = new Logger(`KiwoomBrokerageVendor[${opts.profile}]`);
  }

  get profile(): BrokerageVendorProfile {
    return this.opts.profile;
  }

  async probeAccessToken(): Promise<string> {
    return normalizeTokenResult(await this.opts.tokenSupplier()).token;
  }

  async probeAccessTokenForAccount(accountId: number): Promise<string> {
    return normalizeTokenResult(await this.accountTokenSupplier(accountId)()).token;
  }

  async getAccountBalance(input: GetAccountBalanceInput): Promise<AccountBalanceModel> {
    this.assertProfile('executor', 'getAccountBalance');

    throw new DomainError(
      'getAccountBalance requires an account-scoped executor credential; use getAccountBalanceForAccount',
      'ACCOUNT_SCOPED_CREDENTIAL_REQUIRED',
      { accountExternalId: input.accountId },
    );
  }

  async getAccountBalanceForAccount(
    accountId: number,
    input: GetAccountBalanceInput,
  ): Promise<AccountBalanceModel> {
    this.assertProfile('executor', 'getAccountBalanceForAccount');

    return this.executeGetAccountBalance(input, this.accountTokenSupplier(accountId));
  }

  private async executeGetAccountBalance(
    input: GetAccountBalanceInput,
    tokenSupplier?: KiwoomTokenSupplier,
  ): Promise<AccountBalanceModel> {
    try {
      const body: GetAccountBalanceRequestContract = {
        acntNo: input.accountId,
        qry_tp: '1',
      };

      const response = await this.opts.apiClient.request<
        GetAccountBalanceRequestContract,
        GetAccountBalanceResponseContract
      >({
        apiId: APIID_ACCOUNT_BALANCE,
        endpointPath: PATH_ACCOUNT,
        body,
        tokenSupplier,
        usage: {
          origin: 'TRACKER_ACCOUNT',
          priority: 'P3',
          actionType: 'ACCOUNT_SYNC',
          endpointType: 'REST_ACCOUNT',
        },
      });

      return {
        accountId: response.acntNo,
        currency: response.crncyCd,
        cash: parseNumberOr0(response.cshAmt),
        buyingPower: parseNumberOr0(response.buyPwr),
        equityValue: parseNumberOr0(response.evlAmt),
        snapshotAt: new Date().toISOString(),
      };
    } catch (err) {
      throw this.wrapVendorError(err, 'getAccountBalance', { accountId: input.accountId });
    }
  }

  async getPositions(input: GetPositionsInput): Promise<PositionModel[]> {
    this.assertProfile('executor', 'getPositions');

    throw new DomainError(
      'getPositions requires an account-scoped executor credential; use getPositionsForAccount',
      'ACCOUNT_SCOPED_CREDENTIAL_REQUIRED',
      { accountExternalId: input.accountId },
    );
  }

  async getPositionsForAccount(
    accountId: number,
    input: GetPositionsInput,
  ): Promise<PositionModel[]> {
    this.assertProfile('executor', 'getPositionsForAccount');

    return this.executeGetPositions(input, this.accountTokenSupplier(accountId));
  }

  private async executeGetPositions(
    input: GetPositionsInput,
    tokenSupplier?: KiwoomTokenSupplier,
  ): Promise<PositionModel[]> {
    try {
      const body: GetPositionsRequestContract = {
        acntNo: input.accountId,
        qry_tp: '1',
        // Phase 1 is KRX-only for account positions. Switch this policy to
        // SOR or venue-aware lookup when NXT/SOR account handling is enabled.
        dmst_stex_tp: 'KRX',
      };

      const response = await this.opts.apiClient.request<
        GetPositionsRequestContract,
        GetPositionsResponseContract
      >({
        apiId: APIID_POSITIONS,
        endpointPath: PATH_ACCOUNT,
        body,
        tokenSupplier,
        usage: {
          origin: 'TRACKER_ACCOUNT',
          priority: 'P3',
          actionType: 'ACCOUNT_SYNC',
          endpointType: 'REST_ACCOUNT',
        },
      });

      const snapshotAt = new Date().toISOString();

      return (response.pstnLst ?? []).map((row) => ({
        accountId: response.acntNo,
        symbol: row.stkCd,
        quantity: parseNumberOr0(row.qty),
        averagePrice: parseNumberOr0(row.avgPrc),
        marketValue: parseNumberOr0(row.mktVal),
        unrealizedPnl: parseNumberOr0(row.urlzPnl),
        snapshotAt,
      }));
    } catch (err) {
      throw this.wrapVendorError(err, 'getPositions', { accountId: input.accountId });
    }
  }

  async placeOrder(input: PlaceOrderInput): Promise<OrderAckModel> {
    this.assertProfile('executor', 'placeOrder');

    throw new DomainError(
      'placeOrder requires an account-scoped executor credential; use placeOrderForAccount',
      'ACCOUNT_SCOPED_CREDENTIAL_REQUIRED',
      { accountExternalId: input.accountId },
    );
  }

  async placeOrderForAccount(accountId: number, input: PlaceOrderInput): Promise<OrderAckModel> {
    this.assertProfile('executor', 'placeOrderForAccount');

    // NOTE: the worker-internal accountId PK is unused for the vendor wire
    // call — the vendor needs accountExternalId, which is carried on
    // `input.accountId` (PlaceOrderInput.accountId is documented as the
    // external string). The internal PK threading exists to resolve the
    // executor credential via the per-call token supplier closure
    // configured in brokerage.module.ts — that resolution already happened
    // by the time the supplier returns a token to KiwoomApiClient.
    return this.executePlaceOrder(input, this.accountTokenSupplier(accountId));
  }

  async cancelOrder(input: CancelOrderInput): Promise<OrderAckModel> {
    this.assertProfile('executor', 'cancelOrder');

    throw new DomainError(
      'cancelOrder requires an account-scoped executor credential; use cancelOrderForAccount',
      'ACCOUNT_SCOPED_CREDENTIAL_REQUIRED',
      { accountExternalId: input.accountId, vendorOrderId: input.vendorOrderId },
    );
  }

  async cancelOrderForAccount(
    accountId: number,
    accountExternalId: string,
    externalOrderId: string,
  ): Promise<OrderAckModel> {
    this.assertProfile('executor', 'cancelOrderForAccount');

    // Internal PK only used upstream for credential resolution (via the
    // token supplier closure). Wire body uses accountExternalId.
    return this.executeCancelOrder(
      accountExternalId,
      externalOrderId,
      this.accountTokenSupplier(accountId),
    );
  }

  async modifyOrder(input: ModifyOrderInput): Promise<OrderAckModel> {
    this.assertProfile('executor', 'modifyOrder');

    throw new DomainError(
      'modifyOrder requires an account-scoped executor credential; use modifyOrderForAccount',
      'ACCOUNT_SCOPED_CREDENTIAL_REQUIRED',
      { accountExternalId: input.accountId, vendorOrderId: input.vendorOrderId },
    );
  }

  async modifyOrderForAccount(accountId: number, input: ModifyOrderInput): Promise<OrderAckModel> {
    this.assertProfile('executor', 'modifyOrderForAccount');

    return this.executeModifyOrder(input, this.accountTokenSupplier(accountId));
  }

  async fetchChartCandles(input: FetchChartCandlesInput): Promise<MarketCandleClosedPayload[]> {
    try {
      const baseDt = input.baseDt ?? toYyyyMmDd(input.toIso);
      const isMinute = input.intervalType === '1m';
      const apiId = isMinute ? APIID_CHART_MINUTE : APIID_CHART_DAILY;
      const chartMarket = input.chartMarket ?? (input.marketEnv === 'production' ? 'AL' : 'KRW');
      const requestSymbol = toKiwoomChartSymbol(input.symbol, chartMarket);
      const body: FetchChartCandlesRequestContract = isMinute
        ? {
            stk_cd: requestSymbol,
            base_dt: baseDt,
            tic_scope: '1' /* 1분봉 */,
            upd_stkpc_tp: '1' /* 수정주가반영 */,
          }
        : { stk_cd: requestSymbol, base_dt: baseDt, upd_stkpc_tp: '1' /* 수정주가반영 */ };

      const response = await this.opts.apiClient.request<
        FetchChartCandlesRequestContract,
        FetchChartCandlesResponseContract
      >({
        apiId,
        endpointPath: PATH_CHART,
        body,
        usage: {
          origin: 'COLLECTOR_MARKET',
          priority: 'P2',
          actionType: 'MARKET_DATA',
          endpointType: 'REST_CHART',
        },
        meta: {
          requestId: input.requestId,
          symbol: input.symbol,
          intervalType: input.intervalType,
          chartMarket,
          baseDt,
          fromIso: input.fromIso,
          toIso: input.toIso,
          acceptFromIso: input.acceptFromIso,
          acceptToIso: input.acceptToIso,
        },
      });

      const rows = isMinute
        ? (response.stk_min_pole_chart_qry ?? [])
        : (response.stk_dt_pole_chart_qry ?? []);

      const fromMs = Date.parse(input.acceptFromIso ?? input.fromIso);
      const toMs = Date.parse(input.acceptToIso ?? input.toIso);
      const intervalMs = isMinute ? 60_000 : 24 * 3_600_000;
      const out: MarketCandleClosedPayload[] = [];

      for (const row of rows) {
        const bucketStartMs = parseKiwoomCandleTs(row, isMinute, baseDt);

        if (bucketStartMs === null) continue;

        // Half-open [from, to) window.
        if (bucketStartMs < fromMs || bucketStartMs >= toMs) continue;

        const open = parseKiwoomPriceOrNull(row.op ?? row.open_pric);
        const high = parseKiwoomPriceOrNull(row.hg ?? row.high_pric);
        const low = parseKiwoomPriceOrNull(row.lw ?? row.low_pric);
        const close = parseKiwoomPriceOrNull(row.cp ?? row.cur_prc);
        const volume = parseKiwoomAbsoluteNumberOrNull(
          row.tradeVolume ?? row.trde_qty ?? row.trd_qty ?? row.cntr_qty,
        );

        if (open === null || high === null || low === null || close === null) continue;

        const bucketStart = new Date(bucketStartMs).toISOString();
        const bucketEnd = new Date(bucketStartMs + intervalMs).toISOString();

        // TODO(kiwoom-spec): MarketCandleClosedPayload.intervalType is
        // currently the literal '1m' only — daily catchup needs the event
        // schema to grow a '1d' literal. For now we emit '1m' even for
        // daily fetches so the wire type compiles; calculator side must
        // distinguish via dataSource or a future schema bump.
        out.push({
          provider: 'kiwoom',
          marketEnv: input.marketEnv,
          symbol: input.symbol,
          market: 'unknown',
          chartSource: 'broker_chart_REST',
          chartMarket,
          intervalType: '1m',
          bucketStart,
          bucketEnd,
          open,
          high,
          low,
          close,
          volume: volume ?? 0,
          tickCount: 0,
          firstSourceTs: bucketStart,
          lastSourceTs: bucketStart,
          cumulativeVolumeFirst: null,
          cumulativeVolumeLast: null,
          cumulativeVolumeAnomalies: 0,
          dataSource: 'catchup',
        });
      }

      out.sort((a, b) => Date.parse(a.bucketStart) - Date.parse(b.bucketStart));

      return out;
    } catch (err) {
      throw this.wrapVendorError(err, 'fetchChartCandles', { symbol: input.symbol });
    }
  }

  async getStockMasterList(input: GetStockMasterListInput): Promise<StockMasterEntry[]> {
    void input.marketEnv;

    // Kiwoom's own guide documents 001/101, while mock/examples in the wild
    // often use 0/10. Try the documented code first, then the legacy alias.
    const segments: ReadonlyArray<{
      mrktTps: readonly string[];
      marketCode: StockMasterEntry['marketCode'];
    }> = [
      { mrktTps: ['001', '0'], marketCode: 'KOSPI' },
      { mrktTps: ['101', '10'], marketCode: 'KOSDAQ' },
      { mrktTps: ['50'], marketCode: 'KONEX' },
    ];

    const out: StockMasterEntry[] = [];
    const seen = new Set<string>();

    for (const segment of segments) {
      let segmentRows = 0;

      for (const mrktTp of segment.mrktTps) {
        try {
          const response = await this.opts.apiClient.request<
            GetStockMasterListRequestContract,
            GetStockMasterListResponseContract
          >({
            apiId: APIID_STOCK_MASTER,
            endpointPath: PATH_STOCK_INFO,
            body: { mrkt_tp: mrktTp },
            usage: {
              origin: 'COLLECTOR_MARKET',
              priority: 'P2',
              actionType: 'MARKET_DATA',
              endpointType: 'REST_MARKET_STATS',
            },
          });

          const rows: ReadonlyArray<KiwoomStockMasterRowContract> =
            response.list ?? response.stk_lst ?? response.mst_lst ?? [];

          for (const row of rows) {
            const symbol = row.code ?? row.stkCd ?? row.stk_cd;
            const name = row.name ?? row.stkNm ?? row.stk_nm;

            if (!symbol || !name) continue;

            const key = `${segment.marketCode}:${symbol}`;
            if (seen.has(key)) continue;
            seen.add(key);

            out.push({
              symbol,
              name,
              marketCode: segment.marketCode,
              currency: row.currency ?? 'KRW',
              isinSymbol: row.isin ?? row.isinCd ?? row.isin_cd,
            });

            segmentRows += 1;
          }

          if (segmentRows > 0) break;
        } catch (err) {
          // One market/code candidate failing shouldn't black-hole the whole sync.
          this.logger.warn(
            `getStockMasterList segment=${segment.marketCode} mrkt_tp=${mrktTp} failed: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }

      if (segmentRows === 0) {
        this.logger.warn(`getStockMasterList segment=${segment.marketCode} returned no rows`);
      }
    }

    return out;
  }

  async fetchMarketIndexSnapshots(
    input: FetchMarketIndexSnapshotsInput,
  ): Promise<MarketIndexSnapshot[]> {
    const marketEnv = input.marketEnv === 'production' ? 'PRODUCTION' : 'MOCK';
    const out: MarketIndexSnapshot[] = [];

    for (const symbol of input.symbols) {
      const indexCode = MARKET_INDEX_CODES[symbol];

      try {
        const response = await this.opts.apiClient.request<
          { inds_cd: string; mrkt_tp: string },
          KiwoomMarketIndexCurrentResponseContract
        >({
          apiId: APIID_INDEX_CURRENT,
          endpointPath: PATH_SECTOR,
          body: { inds_cd: indexCode, mrkt_tp: indexCode },
          usage: {
            origin: 'COLLECTOR_MARKET',
            priority: 'P2',
            actionType: 'MARKET_DATA',
            endpointType: 'REST_MARKET_STATS',
          },
        });
        const raw = normalizeIndexResponse(response, symbol);

        out.push({
          provider: 'KIWOOM',
          marketEnv,
          symbol,
          name: pickString(raw, ['inds_nm', 'ind_nm', 'stk_nm']) ?? MARKET_INDEX_NAMES[symbol],
          lastUpdatedAt: new Date().toISOString(),
          value: parseSignedNumberAbs(pickValue(raw, ['cur_prc', 'now_pric', 'prc', 'close_pric'])),
          change: parseSignedNumberStrict(pickValue(raw, ['pred_pre', 'pre', 'change'])),
          changePct: parseSignedNumberStrict(pickValue(raw, ['flu_rt', 'pre_rt', 'change_rt'])),
          volume: parseSignedNumberAbs(pickValue(raw, ['acc_trde_qty', 'trde_qty', 'volume'])),
          tradeValue: parseSignedNumberAbs(
            pickValue(raw, ['acc_trde_prica', 'trde_prica', 'trade_value']),
          ),
        });
      } catch (err) {
        throw this.wrapVendorError(err, 'fetchMarketIndexSnapshots', { symbol });
      }
    }

    return out;
  }

  async connectMarketDataStream(handler: MarketDataFrameHandler): Promise<void> {
    this.frameHandler = handler;

    this.userInitiatedDisconnect = false;

    this.consecutiveLoginFailures = 0;

    this.loginHalted = false;

    this.lastSystemCloseReason = null;

    this.opts.wsClient.onMessage((parsed) => this.routeFrame(parsed));

    this.opts.wsClient.onClose((code, reason) => {
      this.loggedIn = false;
      if (this.activeWsCredential) {
        this.opts.usage?.markWsDisconnected(
          this.opts.profile,
          this.activeWsCredential,
          this.lastSystemCloseReason ?? undefined,
        );

        this.activeWsCredential = null;
      }

      if (this.userInitiatedDisconnect) return;

      if (this.loginHalted) {
        this.logger.debug(
          `ws close code=${code} reason="${reason}" ignored — reconnect halted (token rotation required)`,
        );

        return;
      }

      if (this.opts.reconnect?.enabled) {
        this.logger.warn(
          `ws closed unexpectedly code=${code} reason="${reason}" — scheduling reconnect`,
        );

        void this.scheduleReconnect();
      }
    });

    await this.opts.wsClient.connect();

    await this.performLogin();
  }

  async disconnectMarketDataStream(): Promise<void> {
    this.userInitiatedDisconnect = true;

    if (this.activeWsCredential) {
      this.opts.usage?.markWsDisconnected(this.opts.profile, this.activeWsCredential);
    }
    this.activeWsCredential = null;

    this.subscriptions.clear();

    this.loggedIn = false;

    this.frameHandler = null;

    this.consecutiveLoginFailures = 0;

    this.loginHalted = false;

    this.lastSystemCloseReason = null;

    await this.opts.wsClient.disconnect();
  }

  isMarketDataStreamConnected(): boolean {
    return this.opts.wsClient.isConnected() && this.loggedIn;
  }

  async subscribeMarketData(input: SubscribeMarketDataInput): Promise<MarketDataSubscription> {
    this.assertProfile('collector', 'subscribeMarketData');

    if (input.symbols.length === 0 || input.kinds.length === 0) {
      throw new DomainError(
        'subscribeMarketData requires at least one symbol and one kind',
        'KIWOOM_WS_SUBSCRIBE_EMPTY',
        { symbols: input.symbols.length, kinds: input.kinds.length },
      );
    }

    if (!this.opts.wsClient.isConnected() || !this.loggedIn) {
      throw new DomainError('subscribeMarketData called before LOGIN ack', 'KIWOOM_WS_NOT_READY', {
        profile: this.opts.profile,
        loggedIn: this.loggedIn,
      });
    }

    const additions: Record<string, string[]> = {};

    for (const kind of input.kinds) {
      const realtimeType = KIND_TO_REALTIME_TYPE[kind];

      additions[realtimeType] = additions[realtimeType] ?? [];

      for (const symbol of input.symbols) {
        const kinds = this.subscriptions.get(symbol) ?? new Set();

        if (!kinds.has(kind)) {
          additions[realtimeType].push(symbol);

          kinds.add(kind);

          this.subscriptions.set(symbol, kinds);
        }
      }
    }

    for (const [realtimeType, symbols] of Object.entries(additions)) {
      if (symbols.length === 0) continue;

      await this.opts.wsClient.send({
        trnm: 'REG',
        grp_no: '1',
        refresh: '1',
        data: [{ item: symbols, type: [realtimeType] }],
      });

      this.logger.log(`REG type=${realtimeType} symbols=${symbols.length}`);
    }

    this.recordWsSymbolUsage();

    return {
      subscribedSymbols: Array.from(this.subscriptions.keys()),
      unsubscribe: (unsubInput) =>
        this.unsubscribeMarketData(unsubInput ?? { symbols: input.symbols, kinds: input.kinds }),
    };
  }

  async unsubscribeMarketData(input: UnsubscribeMarketDataInput): Promise<void> {
    this.assertProfile('collector', 'unsubscribeMarketData');

    if (!this.opts.wsClient.isConnected()) return;

    const kinds = input.kinds ?? (['trade-tick', 'orderbook'] as MarketDataFrameKind[]);
    const removals: Record<string, string[]> = {};

    for (const kind of kinds) {
      const realtimeType = KIND_TO_REALTIME_TYPE[kind];

      removals[realtimeType] = removals[realtimeType] ?? [];

      for (const symbol of input.symbols) {
        const symbolKinds = this.subscriptions.get(symbol);

        if (!symbolKinds || !symbolKinds.has(kind)) continue;

        removals[realtimeType].push(symbol);

        symbolKinds.delete(kind);

        if (symbolKinds.size === 0) this.subscriptions.delete(symbol);
      }
    }

    for (const [realtimeType, symbols] of Object.entries(removals)) {
      if (symbols.length === 0) continue;

      await this.opts.wsClient.send({
        trnm: 'REMOVE',
        grp_no: '1',
        data: [{ item: symbols, type: [realtimeType] }],
      });

      this.logger.log(`REMOVE type=${realtimeType} symbols=${symbols.length}`);
    }

    this.recordWsSymbolUsage();
  }

  private async executePlaceOrder(
    input: PlaceOrderInput,
    tokenSupplier?: KiwoomTokenSupplier,
  ): Promise<OrderAckModel> {
    try {
      const apiId = input.side === 'buy' ? APIID_PLACE_BUY : APIID_PLACE_SELL;
      // ordTp: 00 = 지정가 (limit), 03 = 시장가 (market).
      // TODO(kiwoom-spec): confirm exact ordTp codes against Kiwoom REST
      // — '00'/'03' are the historical TR convention but REST may differ.
      const ordTp = input.type === 'limit' ? '00' : '03';
      // ordSide on the request contract is required by the contract type;
      // Kiwoom historically encodes buy/sell via the apiId itself (split
      // BUY/SELL apiIds), but we keep the wire field populated to satisfy
      // the contract and any future-unified endpoint.
      // TODO(kiwoom-spec): confirm '2'=buy / '1'=sell mapping; some
      // Kiwoom TR docs invert these.
      const ordSide = input.side === 'buy' ? '2' : '1';

      const body: PlaceOrderRequestContract = {
        acntNo: input.accountId, // external string per PlaceOrderInput doc
        stkCd: input.symbol,
        ordTp,
        ordSide,
        qty: input.quantity,
        prc: input.price,
        clOrdId: input.clientOrderId,
      };

      const response = await this.opts.apiClient.request<
        PlaceOrderRequestContract,
        PlaceOrderResponseContract
      >({
        apiId,
        endpointPath: PATH_ORDER,
        body,
        tokenSupplier,
        usage: {
          origin: 'EXECUTOR_STRATEGY',
          priority: 'P1',
          actionType: 'ORDER',
          endpointType: 'REST_ORDER',
        },
      });

      return mapOrderResponseToAck(response, 'accepted');
    } catch (err) {
      throw this.wrapVendorError(err, 'placeOrder', {
        clientOrderId: input.clientOrderId,
      });
    }
  }

  private async executeCancelOrder(
    accountExternalId: string,
    externalOrderId: string,
    tokenSupplier?: KiwoomTokenSupplier,
  ): Promise<OrderAckModel> {
    try {
      const body: CancelOrderRequestContract = {
        acntNo: accountExternalId,
        ordNo: externalOrderId,
      };

      const response = await this.opts.apiClient.request<
        CancelOrderRequestContract,
        CancelOrderResponseContract
      >({
        apiId: APIID_CANCEL,
        endpointPath: PATH_ORDER,
        body,
        tokenSupplier,
        usage: {
          origin: 'EXECUTOR_STRATEGY',
          priority: 'P1',
          actionType: 'CANCEL',
          endpointType: 'REST_ORDER',
        },
      });

      return mapOrderResponseToAck(response, 'cancelled');
    } catch (err) {
      throw this.wrapVendorError(err, 'cancelOrder', {
        accountExternalId,
        externalOrderId,
      });
    }
  }

  private async executeModifyOrder(
    input: ModifyOrderInput,
    tokenSupplier?: KiwoomTokenSupplier,
  ): Promise<OrderAckModel> {
    try {
      const body: ModifyOrderRequestContract = {
        acntNo: input.accountId,
        ordNo: input.vendorOrderId,
        qty: input.quantity,
        prc: input.price,
      };

      const response = await this.opts.apiClient.request<
        ModifyOrderRequestContract,
        ModifyOrderResponseContract
      >({
        apiId: APIID_MODIFY,
        endpointPath: PATH_ORDER,
        body,
        tokenSupplier,
        usage: {
          origin: 'EXECUTOR_STRATEGY',
          priority: 'P1',
          actionType: 'MODIFY',
          endpointType: 'REST_ORDER',
        },
      });

      return mapOrderResponseToAck(response, 'accepted');
    } catch (err) {
      throw this.wrapVendorError(err, 'modifyOrder', {
        vendorOrderId: input.vendorOrderId,
      });
    }
  }

  private routeFrame(parsed: unknown): void {
    const trnm = isPlainObject(parsed) ? parsed.trnm : null;

    if (trnm === 'PING') {
      void this.opts.wsClient.send({ trnm: 'PING' }).catch((err) => {
        this.logger.warn(`PING ack failed: ${err instanceof Error ? err.message : err}`);
      });

      return;
    }

    if (trnm === 'SYSTEM' && isPlainObject(parsed)) {
      void this.handleSystemFrame(parsed);

      return;
    }

    if (trnm === 'LOGIN' || trnm === 'REG' || trnm === 'REMOVE') return;

    this.frameHandler?.(parsed);
  }

  private async handleSystemFrame(parsed: Record<string, unknown>): Promise<void> {
    const code = typeof parsed.code === 'string' ? parsed.code : null;
    const message = typeof parsed.message === 'string' ? parsed.message : 'Kiwoom SYSTEM frame';

    this.logger.warn(`SYSTEM code=${code ?? '<unknown>'} message="${message}"`);
    this.lastSystemCloseReason = `Kiwoom SYSTEM ${code ?? '<unknown>'}: ${message}`;

    if (code !== 'R10001') return;

    // Kiwoom sends R10001 when another session uses the same AppKey, then closes
    // this socket with code=1000/Bye. Reconnecting immediately just creates a
    // session fight, so mark this credential limited and let fan-out redistribute.
    this.loginHalted = true;
    await this.recordWsLimited(new Error(`Kiwoom SYSTEM ${code}: ${message}`));
  }

  private installLoginAckGate(): Promise<void> {
    const timeoutMs = this.opts.loginAckTimeoutMs ?? DEFAULT_LOGIN_ACK_TIMEOUT_MS;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();

        reject(new IntegrationError('Kiwoom LOGIN ack timeout', { timeoutMs }));
      }, timeoutMs);

      const unsubscribe = this.opts.wsClient.onMessage((parsed) => {
        if (!isPlainObject(parsed)) return;

        if (parsed.trnm !== 'LOGIN') return;

        clearTimeout(timer);

        unsubscribe();

        const returnCode = (parsed as { return_code?: unknown }).return_code;

        if (returnCode === 0 || returnCode === '0') {
          this.loggedIn = true;

          this.logger.log('LOGIN ack ok');

          resolve();
        } else {
          const msg = (parsed as { return_msg?: unknown }).return_msg;

          reject(
            new IntegrationError(`Kiwoom LOGIN failed return_code=${String(returnCode)}`, {
              returnCode,
              returnMsg: typeof msg === 'string' ? msg : null,
            }),
          );
        }
      });
    });
  }

  private accountTokenSupplier(accountId: number): KiwoomTokenSupplier {
    if (!this.opts.accountTokenSupplier) {
      throw new DomainError(
        'account-scoped token supplier is not configured',
        'ACCOUNT_TOKEN_SUPPLIER_MISSING',
        { profile: this.opts.profile, accountId },
      );
    }

    const supplier = this.opts.accountTokenSupplier;

    return () => supplier(accountId);
  }

  private async performLogin(): Promise<void> {
    let tokenResult = normalizeTokenResult(await this.opts.tokenSupplier());

    try {
      await this.sendLoginAndWait(tokenResult.token);
    } catch (err) {
      const retryTokenResult = await this.refreshWsLoginToken(tokenResult, err);

      if (!retryTokenResult) {
        await this.recordWsLoginFailure(err, tokenResult.credential);

        throw err;
      }

      tokenResult = retryTokenResult;

      try {
        await this.sendLoginAndWait(tokenResult.token);
      } catch (retryErr) {
        await this.recordWsLoginFailure(retryErr, tokenResult.credential);

        throw retryErr;
      }
    }

    if (
      this.activeWsCredential &&
      (!tokenResult.credential ||
        this.activeWsCredential.credentialId !== tokenResult.credential.credentialId)
    ) {
      this.opts.usage?.markWsDisconnected(this.opts.profile, this.activeWsCredential);
    }

    this.activeWsCredential = tokenResult.credential;
    this.lastSystemCloseReason = null;
    if (tokenResult.credential) {
      if (this.opts.profile === 'collector' && tokenResult.credential.kind === 'collector') {
        await this.opts.collectorRuntimeState?.markSuccess({
          credentialId: tokenResult.credential.credentialId,
          source: 'WS',
        });
      }
      // Tracker execution WS must pass TRACKER_STATUS/WS overrides before it is enabled.
      // The current active path is collector-only, where default COLLECTOR_MARKET is correct.
      this.opts.usage?.markWsConnected(
        this.opts.profile,
        tokenResult.credential,
        this.subscriptions.size,
        Array.from(this.subscriptions.keys()),
      );
    }

    const delay = this.opts.postLoginDelayMs ?? DEFAULT_POST_LOGIN_DELAY_MS;

    if (delay > 0) await sleep(delay);
  }

  private async sendLoginAndWait(token: string): Promise<void> {
    const ack = this.installLoginAckGate();

    await this.opts.wsClient.send({ trnm: 'LOGIN', token });

    await ack;
  }

  private async refreshWsLoginToken(
    tokenResult: ReturnType<typeof normalizeTokenResult>,
    err: unknown,
  ): Promise<ReturnType<typeof normalizeTokenResult> | null> {
    if (!tokenResult.invalidate || !isTokenRejected(err)) return null;

    tokenResult.invalidate();

    const next = normalizeTokenResult(await this.opts.tokenSupplier());
    if (!next.token || next.token === tokenResult.token) return null;

    return next;
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnecting) return;

    this.reconnecting = true;

    const initial = this.opts.reconnect?.initialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY_MS;
    const maxDelay = this.opts.reconnect?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    const maxAttempts = this.opts.reconnect?.maxAttempts ?? DEFAULT_RECONNECT_MAX_ATTEMPTS;

    try {
      while (!this.userInitiatedDisconnect) {
        this.reconnectAttempts += 1;

        if (maxAttempts > 0 && this.reconnectAttempts > maxAttempts) {
          this.logger.error(`reconnect gave up after ${maxAttempts} attempts`);

          return;
        }

        const delay = Math.min(initial * 2 ** (this.reconnectAttempts - 1), maxDelay);

        this.logger.log(`reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

        await sleep(delay);

        if (this.userInitiatedDisconnect) return;

        try {
          await this.opts.wsClient.disconnect();
        } catch {
          // best-effort cleanup; swallow and try to connect anyway
        }

        try {
          await this.opts.wsClient.connect();

          await this.performLogin();

          await this.replaySubscriptions();

          this.reconnectAttempts = 0;

          this.consecutiveLoginFailures = 0;

          this.logger.log('reconnect ok');

          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);

          this.logger.warn(`reconnect attempt ${this.reconnectAttempts} failed: ${message}`);

          if (isLoginFailure(err)) {
            this.opts.invalidateToken?.();

            this.consecutiveLoginFailures += 1;

            if (this.consecutiveLoginFailures >= 3) {
              this.loginHalted = true;

              this.logger.error(
                'reconnect halted: LOGIN keeps failing — appKey/appSecret may be wrong or revoked. Verify credentials then POST /admin/ws/reconnect.',
              );

              return;
            }
          } else {
            this.consecutiveLoginFailures = 0;
          }
        }
      }
    } finally {
      this.reconnecting = false;
    }
  }

  private async replaySubscriptions(): Promise<void> {
    const byType: Record<string, string[]> = {};

    for (const [symbol, kinds] of this.subscriptions) {
      for (const kind of kinds) {
        const realtimeType = KIND_TO_REALTIME_TYPE[kind];

        byType[realtimeType] = byType[realtimeType] ?? [];

        byType[realtimeType].push(symbol);
      }
    }

    for (const [realtimeType, symbols] of Object.entries(byType)) {
      if (symbols.length === 0) continue;

      await this.opts.wsClient.send({
        trnm: 'REG',
        grp_no: '1',
        refresh: '1',
        data: [{ item: symbols, type: [realtimeType] }],
      });

      this.logger.log(`REG (replay) type=${realtimeType} symbols=${symbols.length}`);
    }

    this.recordWsSymbolUsage();
  }

  private recordWsSymbolUsage(): void {
    if (!this.activeWsCredential) return;

    // Tracker execution WS must pass origin/action overrides before it is enabled.
    // The current active path is collector-only, where default COLLECTOR_MARKET is correct.
    this.opts.usage?.markWsSymbols(
      this.opts.profile,
      this.activeWsCredential,
      this.subscriptions.size,
      Array.from(this.subscriptions.keys()),
    );
  }

  private async recordWsLoginFailure(
    err: unknown,
    credential = this.activeWsCredential,
  ): Promise<void> {
    if (isCredentialAuthFailure(err)) {
      await this.recordWsAuthFailed(err, credential);

      return;
    }

    await this.recordWsLimited(err, credential);
  }

  private async recordWsLimited(err: unknown, credential = this.activeWsCredential): Promise<void> {
    if (this.opts.profile !== 'collector' || !credential) return;

    await this.opts.collectorRuntimeState?.markWsLimited({
      credentialId: credential.credentialId,
      reason: `WS limited suspected: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  private async recordWsAuthFailed(
    err: unknown,
    credential = this.activeWsCredential,
  ): Promise<void> {
    if (this.opts.profile !== 'collector' || !credential) return;

    await this.opts.collectorRuntimeState?.markAuthFailed({
      credentialId: credential.credentialId,
      source: 'WS',
      reason: `WS auth failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  private assertProfile(expected: BrokerageVendorProfile, method: string): void {
    if (this.opts.profile !== expected) {
      throw new NotImplementedError(
        `${method} called on ${this.opts.profile} gateway (expected ${expected})`,
        { profile: this.opts.profile, method },
      );
    }
  }

  // Wrap any non-DomainError into IntegrationError so callers can switch on
  // err.code without leaking raw fetch/parse exceptions out of the vendor.
  private wrapVendorError(
    err: unknown,
    method: string,
    context: Record<string, unknown>,
  ): DomainError {
    if (err instanceof DomainError) return err;

    return new IntegrationError(
      `kiwoom ${method} failed: ${err instanceof Error ? err.message : String(err)}`,
      { profile: this.opts.profile, method, ...context },
    );
  }
}

const KIND_TO_REALTIME_TYPE: Record<MarketDataFrameKind, string> = {
  'trade-tick': '0B',
  orderbook: '0D',
  'market-index': '0J',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLoginFailure(err: unknown): boolean {
  if (!(err instanceof IntegrationError)) return false;

  const message = err.message ?? '';

  return message.startsWith('Kiwoom LOGIN failed') || message === 'Kiwoom LOGIN ack timeout';
}

function isCredentialAuthFailure(err: unknown): boolean {
  if (!(err instanceof IntegrationError)) return false;

  const details = err.details ?? {};
  const returnMsg = typeof details.returnMsg === 'string' ? details.returnMsg.toLowerCase() : '';
  const returnCode = String(details.returnCode ?? '').toLowerCase();
  const message = err.message.toLowerCase();
  const haystack = `${returnCode} ${returnMsg} ${message}`;

  return (
    haystack.includes('auth') ||
    haystack.includes('token') ||
    haystack.includes('invalid') ||
    haystack.includes('unauthorized') ||
    haystack.includes('인증') ||
    haystack.includes('토큰')
  );
}

function isTokenRejected(err: unknown): boolean {
  if (!(err instanceof IntegrationError)) return false;

  const details = err.details ?? {};
  const returnMsg = typeof details.returnMsg === 'string' ? details.returnMsg.toLowerCase() : '';
  const returnCode = String(details.returnCode ?? '').toLowerCase();
  const message = err.message.toLowerCase();
  const haystack = `${returnCode} ${returnMsg} ${message}`;

  return (
    haystack.includes('token') ||
    haystack.includes('토큰') ||
    haystack.includes('expired') ||
    haystack.includes('만료')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNumberOr0(input: string | number | undefined | null): number {
  if (input === null || input === undefined) return 0;

  const n = typeof input === 'number' ? input : parseFloat(input);

  return Number.isFinite(n) ? n : 0;
}

function parseKiwoomPriceOrNull(value: unknown): number | null {
  // Kiwoom REST chart fields encode previous-day direction in the sign
  // bit (`-274000` means price 274000, down vs previous day). KRX stock
  // instruments trade at positive prices, so abs is the correct candle
  // magnitude. Revisit this if expanding to products that can have
  // negative prices.
  const n = parseSignedNumber(value);

  return n === null ? null : Math.abs(n);
}

function parseKiwoomAbsoluteNumberOrNull(value: unknown): number | null {
  // Volumes are magnitudes for candle storage even when a vendor sends a
  // signed representation.
  const n = parseSignedNumber(value);

  return n === null ? null : Math.abs(n);
}

function normalizeIndexResponse(
  response: KiwoomMarketIndexCurrentResponseContract,
  symbol: MarketIndexSymbol,
): Record<string, unknown> {
  const candidates = [
    response,
    firstObject(response.industry_current_price),
    firstObject(response.inds_cur_prc),
    firstObject(response.ind_cur_prc),
    firstObject(response.output),
    firstObject(response.list),
  ];
  const code = MARKET_INDEX_CODES[symbol];

  return (
    candidates.find(
      (row) =>
        row &&
        (pickString(row, ['inds_cd', 'ind_cd', 'mrkt_tp']) === code ||
          pickString(row, ['inds_nm', 'ind_nm', 'stk_nm']) === MARKET_INDEX_NAMES[symbol]),
    ) ??
    candidates.find(Boolean) ??
    response
  );
}

function firstObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'object' && item !== null);

    return first ? (first as Record<string, unknown>) : null;
  }

  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;

  return null;
}

function pickValue(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }

  return null;
}

function pickString(row: Record<string, unknown>, keys: readonly string[]): string | null {
  const value = pickValue(row, keys);

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseSignedNumberStrict(value: unknown): number | null {
  return parseSignedNumber(value);
}

function parseSignedNumberAbs(value: unknown): number | null {
  const n = parseSignedNumber(value);

  return n === null ? null : Math.abs(n);
}

function toYyyyMmDd(iso: string): string {
  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return '';

  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');

  return `${y}${m}${day}`;
}

// Parse the candle timestamp returned by Kiwoom chart endpoints.
// Minute rows ship `cntr_tm` (HHmmss or YYYYMMDDHHmmss); daily rows ship
// `dt` (YYYYMMDD). TODO(kiwoom-spec): exact field/format mapping needs
// verification against a real mock-env response.
function parseKiwoomCandleTs(
  row: KiwoomChartCandleRowContract,
  isMinute: boolean,
  baseDt: string,
): number | null {
  if (isMinute) {
    const raw = row.cntr_tm ?? row.dt;

    if (!raw) return null;

    // Kiwoom chart timestamps are KST exchange times. Persist buckets in UTC.
    if (raw.length === 14) {
      const y = Number(raw.slice(0, 4));
      const mo = Number(raw.slice(4, 6)) - 1;
      const d = Number(raw.slice(6, 8));
      const h = Number(raw.slice(8, 10));
      const mi = Number(raw.slice(10, 12));
      const s = Number(raw.slice(12, 14));

      if ([y, mo, d, h, mi, s].some((v) => Number.isNaN(v))) return null;

      return Date.UTC(y, mo, d, h, mi, s) - KST_OFFSET_MS;
    }

    if (raw.length === 6 && baseDt.length === 8) {
      const y = Number(baseDt.slice(0, 4));
      const mo = Number(baseDt.slice(4, 6)) - 1;
      const d = Number(baseDt.slice(6, 8));
      const h = Number(raw.slice(0, 2));
      const mi = Number(raw.slice(2, 4));
      const s = Number(raw.slice(4, 6));

      if ([y, mo, d, h, mi, s].some((v) => Number.isNaN(v))) return null;

      return Date.UTC(y, mo, d, h, mi, s) - KST_OFFSET_MS;
    }

    return null;
  }

  const raw = row.dt;

  if (!raw || raw.length !== 8) return null;

  const y = Number(raw.slice(0, 4));
  const mo = Number(raw.slice(4, 6)) - 1;
  const d = Number(raw.slice(6, 8));

  if ([y, mo, d].some((v) => Number.isNaN(v))) return null;

  return Date.UTC(y, mo, d) - KST_OFFSET_MS;
}

function toKiwoomChartSymbol(symbol: string, chartMarket: CandleChartMarket): string {
  if (chartMarket === 'AL') {
    return symbol.endsWith('_AL') ? symbol : `${stripKiwoomVenueSuffix(symbol)}_AL`;
  }
  if (chartMarket === 'NXT') {
    return symbol.endsWith('_NX') ? symbol : `${stripKiwoomVenueSuffix(symbol)}_NX`;
  }

  return stripKiwoomVenueSuffix(symbol);
}

function stripKiwoomVenueSuffix(symbol: string): string {
  return symbol.replace(/_(AL|NX)$/u, '');
}

function mapOrderResponseToAck(
  response: PlaceOrderResponseContract | CancelOrderResponseContract | ModifyOrderResponseContract,
  status: OrderAckModel['status'],
): OrderAckModel {
  const side: OrderSide = response.ordSide === '2' ? 'buy' : 'sell';
  // ordTp '00'=limit, '03'=market — matches encoding in executePlaceOrder.
  // TODO(kiwoom-spec): keep in sync with the encoder above when the real
  // ordTp catalogue is confirmed.
  const type: OrderType = response.ordTp === '03' ? 'market' : 'limit';

  return {
    vendorOrderId: response.ordNo,
    clientOrderId: response.clOrdId,
    accountId: response.acntNo,
    symbol: response.stkCd,
    side,
    type,
    quantity: parseNumberOr0(response.qty),
    price: response.prc !== undefined ? parseNumberOr0(response.prc) : undefined,
    status,
    acceptedAt: response.acceptedAt,
  };
}
