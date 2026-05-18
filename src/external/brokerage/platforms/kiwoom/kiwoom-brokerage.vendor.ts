import { Logger } from '@nestjs/common';
import { DomainError, IntegrationError, NotImplementedError } from '@common/error/domain.error';
import type { MarketCandleClosedPayload } from '@shared/event/market-candle-closed.event';
import type { BrokerageVendorProfile } from '../../brokerage.token';
import type {
  BrokerageVendor,
  CancelOrderInput,
  FetchChartCandlesInput,
  GetAccountBalanceInput,
  GetPositionsInput,
  GetStockMasterListInput,
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

// Endpoint category paths. Kiwoom REST groups apiIds by domain category.
// TODO(kiwoom-spec): verify each category against current Kiwoom REST docs.
const PATH_ORDER = '/api/dostk/ordr';
const PATH_ACCOUNT = '/api/dostk/acnt';
const PATH_CHART = '/api/dostk/chart';
const PATH_MARKET_COND = '/api/dostk/mrkcond';

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
      const body: GetAccountBalanceRequestContract = { acntNo: input.accountId };

      const response = await this.opts.apiClient.request<
        GetAccountBalanceRequestContract,
        GetAccountBalanceResponseContract
      >({
        apiId: APIID_ACCOUNT_BALANCE,
        endpointPath: PATH_ACCOUNT,
        body,
        tokenSupplier,
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
      const body: GetPositionsRequestContract = { acntNo: input.accountId };

      const response = await this.opts.apiClient.request<
        GetPositionsRequestContract,
        GetPositionsResponseContract
      >({
        apiId: APIID_POSITIONS,
        endpointPath: PATH_ACCOUNT,
        body,
        tokenSupplier,
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

  async placeOrderForAccount(
    accountId: number,
    input: PlaceOrderInput,
  ): Promise<OrderAckModel> {
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

  async modifyOrderForAccount(
    accountId: number,
    input: ModifyOrderInput,
  ): Promise<OrderAckModel> {
    this.assertProfile('executor', 'modifyOrderForAccount');

    return this.executeModifyOrder(input, this.accountTokenSupplier(accountId));
  }

  async fetchChartCandles(
    input: FetchChartCandlesInput,
  ): Promise<MarketCandleClosedPayload[]> {
    try {
      const baseDt = toYyyyMmDd(input.toIso);
      const isMinute = input.intervalType === '1m';
      const apiId = isMinute ? APIID_CHART_MINUTE : APIID_CHART_DAILY;
      const body: FetchChartCandlesRequestContract = isMinute
        ? { stkCd: input.symbol, baseDt, tic_scope: '1' /* 1분봉 */ }
        : { stkCd: input.symbol, baseDt, upd_stkpc_tp: '1' /* 수정주가반영 */ };

      const response = await this.opts.apiClient.request<
        FetchChartCandlesRequestContract,
        FetchChartCandlesResponseContract
      >({
        apiId,
        endpointPath: PATH_CHART,
        body,
      });

      const rows = isMinute
        ? response.stk_min_pole_chart_qry ?? []
        : response.stk_dt_pole_chart_qry ?? [];

      const fromMs = Date.parse(input.fromIso);
      const toMs = Date.parse(input.toIso);
      const intervalMs = isMinute ? 60_000 : 24 * 3_600_000;
      const out: MarketCandleClosedPayload[] = [];

      for (const row of rows) {
        const bucketStartMs = parseKiwoomCandleTs(row, isMinute);

        if (bucketStartMs === null) continue;

        // Half-open [from, to) window.
        if (bucketStartMs < fromMs || bucketStartMs >= toMs) continue;

        const open = parseNumberOrNull(row.op ?? row.open_pric);
        const high = parseNumberOrNull(row.hg ?? row.high_pric);
        const low = parseNumberOrNull(row.lw ?? row.low_pric);
        const close = parseNumberOrNull(row.cp ?? row.cur_prc);
        const volume = parseNumberOrNull(row.tradeVolume ?? row.trd_qty ?? row.cntr_qty);

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

    // Kiwoom requires one call per market segment. Three best-effort
    // segment codes — see the TODO in the request contract.
    const segments: ReadonlyArray<{ mrktTp: string; marketCode: StockMasterEntry['marketCode'] }> =
      [
        { mrktTp: '0', marketCode: 'KOSPI' },
        { mrktTp: '10', marketCode: 'KOSDAQ' },
        { mrktTp: '8', marketCode: 'KONEX' },
      ];

    const out: StockMasterEntry[] = [];

    for (const segment of segments) {
      try {
        const response = await this.opts.apiClient.request<
          GetStockMasterListRequestContract,
          GetStockMasterListResponseContract
        >({
          apiId: APIID_STOCK_MASTER,
          endpointPath: PATH_MARKET_COND,
          body: { mrktTp: segment.mrktTp },
        });

        const rows: ReadonlyArray<KiwoomStockMasterRowContract> =
          response.list ?? response.stk_lst ?? response.mst_lst ?? [];

        for (const row of rows) {
          const symbol = row.code ?? row.stkCd ?? row.stk_cd;
          const name = row.name ?? row.stkNm ?? row.stk_nm;

          if (!symbol || !name) continue;

          out.push({
            symbol,
            name,
            marketCode: segment.marketCode,
            currency: row.currency ?? 'KRW',
            isinSymbol: row.isin ?? row.isinCd ?? row.isin_cd,
          });
        }
      } catch (err) {
        // One market failing shouldn't black-hole the whole sync.
        this.logger.warn(
          `getStockMasterList segment=${segment.marketCode} failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return out;
  }

  async connectMarketDataStream(handler: MarketDataFrameHandler): Promise<void> {
    this.frameHandler = handler;

    this.userInitiatedDisconnect = false;

    this.consecutiveLoginFailures = 0;

    this.loginHalted = false;

    this.opts.wsClient.onMessage((parsed) => this.routeFrame(parsed));

    this.opts.wsClient.onClose((code, reason) => {
      this.loggedIn = false;
      if (this.activeWsCredential) {
        this.opts.usage?.markWsDisconnected(this.opts.profile, this.activeWsCredential);
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

    if (trnm === 'LOGIN' || trnm === 'PING' || trnm === 'REG' || trnm === 'REMOVE') return;

    this.frameHandler?.(parsed);
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
    const tokenResult = normalizeTokenResult(await this.opts.tokenSupplier());
    const ack = this.installLoginAckGate();

    await this.opts.wsClient.send({ trnm: 'LOGIN', token: tokenResult.token });

    await ack;

    if (
      this.activeWsCredential &&
      (!tokenResult.credential ||
        this.activeWsCredential.credentialId !== tokenResult.credential.credentialId)
    ) {
      this.opts.usage?.markWsDisconnected(this.opts.profile, this.activeWsCredential);
    }

    this.activeWsCredential = tokenResult.credential;
    if (tokenResult.credential) {
      this.opts.usage?.markWsConnected(
        this.opts.profile,
        tokenResult.credential,
        this.subscriptions.size,
      );
    }

    const delay = this.opts.postLoginDelayMs ?? DEFAULT_POST_LOGIN_DELAY_MS;

    if (delay > 0) await sleep(delay);
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

    this.opts.usage?.markWsSymbols(
      this.opts.profile,
      this.activeWsCredential,
      this.subscriptions.size,
    );
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
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLoginFailure(err: unknown): boolean {
  if (!(err instanceof IntegrationError)) return false;

  const message = err.message ?? '';

  return message.startsWith('Kiwoom LOGIN failed') || message === 'Kiwoom LOGIN ack timeout';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNumberOr0(input: string | number | undefined | null): number {
  if (input === null || input === undefined) return 0;

  const n = typeof input === 'number' ? input : parseFloat(input);

  return Number.isFinite(n) ? n : 0;
}

function parseNumberOrNull(input: string | number | undefined | null): number | null {
  if (input === null || input === undefined || input === '') return null;

  const n = typeof input === 'number' ? input : parseFloat(input);

  return Number.isFinite(n) ? n : null;
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
): number | null {
  if (isMinute) {
    const raw = row.cntr_tm ?? row.dt;

    if (!raw) return null;

    // Accept YYYYMMDDHHmmss as the safe format.
    if (raw.length === 14) {
      const y = Number(raw.slice(0, 4));
      const mo = Number(raw.slice(4, 6)) - 1;
      const d = Number(raw.slice(6, 8));
      const h = Number(raw.slice(8, 10));
      const mi = Number(raw.slice(10, 12));
      const s = Number(raw.slice(12, 14));

      if ([y, mo, d, h, mi, s].some((v) => Number.isNaN(v))) return null;

      return Date.UTC(y, mo, d, h, mi, s);
    }

    return null;
  }

  const raw = row.dt;

  if (!raw || raw.length !== 8) return null;

  const y = Number(raw.slice(0, 4));
  const mo = Number(raw.slice(4, 6)) - 1;
  const d = Number(raw.slice(6, 8));

  if ([y, mo, d].some((v) => Number.isNaN(v))) return null;

  return Date.UTC(y, mo, d);
}

function mapOrderResponseToAck(
  response:
    | PlaceOrderResponseContract
    | CancelOrderResponseContract
    | ModifyOrderResponseContract,
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
