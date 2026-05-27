import { Logger } from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import { Brokerage } from '@shared/model/account/brokerage.enum';
import { MarketEnv } from '@shared/model/api-credential/market-env.enum';
import type { KiwoomConfig } from '@config/kiwoom.config';
import type {
  BrokerageVendor,
  CancelOrderInput,
  FetchChartCandlesInput,
  FetchDashboardMarketFlowsInput,
  FetchDashboardMarketMoversInput,
  FetchMarketIndexSnapshotsInput,
  GetAccountBalanceInput,
  GetPositionsInput,
  GetStockMasterListInput,
  MarketDataFrameHandler,
  MarketDataFrameKind,
  MarketDataSubscription,
  ModifyOrderInput,
  PlaceOrderInput,
  SubscribeMarketDataInput,
  UnsubscribeMarketDataInput,
} from '../../vendor/brokerage.vendor';
import type { AccountBalanceModel, PositionModel } from '../../model/account.model';
import type { OrderAckModel } from '../../model/order.model';
import type { MarketCandleClosedPayload } from '@shared/event/market-candle-closed.event';
import { MARKET_INDEX_CODES } from '@shared/event/market-index.event';
import type {
  MarketIndexSnapshot,
  StockMasterEntry,
} from '../../vendor/brokerage.vendor';
import type { DashboardMarketFlowPayload, DashboardMarketMoverPayload } from '@shared/event/market-dashboard.event';
import type { CredentialSourceService } from '../../credential/credential-source.service';
import type { AccessTokenCacheService } from '../../auth/access-token-cache.service';
import type { CredentialUsageService } from '../../credential/credential-usage.service';
import type { CollectorCredentialLimitRepository } from '@shared/persistence/collector-credential/collector-credential-limit.repository';
import type { KiwoomApiClient } from './kiwoom.api-client';
import { KiwoomBrokerageVendor } from './kiwoom-brokerage.vendor';
import { KiwoomWsClient } from './kiwoom-ws.client';

interface CollectorWsFanoutOptions {
  readonly delegate: BrokerageVendor;
  readonly config: KiwoomConfig;
  readonly apiClient: KiwoomApiClient;
  readonly source: CredentialSourceService;
  readonly tokenCache: AccessTokenCacheService;
  readonly usage: CredentialUsageService;
  readonly collectorRuntimeState: CollectorCredentialLimitRepository;
}

type Child = {
  readonly credentialId: number;
  readonly vendor: KiwoomBrokerageVendor;
  readonly symbols: Set<string>;
  readonly wsMaxSymbols: number | null;
};

const CONNECT_FAILURE_BACKOFF_MS = 5 * 60_000;
const DEFAULT_WS_MAX_SYMBOLS = 100;
const DEFAULT_MARKET_INDEX_SYMBOLS = Object.values(MARKET_INDEX_CODES);
const MARKET_INDEX_SYMBOLS = new Set(DEFAULT_MARKET_INDEX_SYMBOLS);

export class KiwoomCollectorWsFanoutVendor implements BrokerageVendor {
  private readonly logger = new Logger(KiwoomCollectorWsFanoutVendor.name);

  private handler: MarketDataFrameHandler | null = null;

  private children = new Map<number, Child>();

  private connectBackoffUntil = new Map<number, number>();

  private ensurePromise: Promise<void> | null = null;

  private lastCapDroppedSymbols: string[] = [];

  private lastKinds: readonly MarketDataFrameKind[] = ['trade-tick'];

  constructor(private readonly opts: CollectorWsFanoutOptions) {}

  getAccountBalance(input: GetAccountBalanceInput): Promise<AccountBalanceModel> {
    return this.opts.delegate.getAccountBalance(input);
  }

  getAccountBalanceForAccount(
    accountId: number,
    input: GetAccountBalanceInput,
  ): Promise<AccountBalanceModel> {
    return this.opts.delegate.getAccountBalanceForAccount(accountId, input);
  }

  getPositions(input: GetPositionsInput): Promise<PositionModel[]> {
    return this.opts.delegate.getPositions(input);
  }

  getPositionsForAccount(accountId: number, input: GetPositionsInput): Promise<PositionModel[]> {
    return this.opts.delegate.getPositionsForAccount(accountId, input);
  }

  fetchChartCandles(input: FetchChartCandlesInput): Promise<MarketCandleClosedPayload[]> {
    return this.opts.delegate.fetchChartCandles(input);
  }

  getStockMasterList(input: GetStockMasterListInput): Promise<StockMasterEntry[]> {
    return this.opts.delegate.getStockMasterList(input);
  }

  fetchMarketIndexSnapshots(input: FetchMarketIndexSnapshotsInput): Promise<MarketIndexSnapshot[]> {
    return this.opts.delegate.fetchMarketIndexSnapshots(input);
  }

  fetchDashboardMarketFlows(
    input: FetchDashboardMarketFlowsInput,
  ): Promise<DashboardMarketFlowPayload[]> {
    return this.opts.delegate.fetchDashboardMarketFlows(input);
  }

  fetchDashboardMarketMovers(input: FetchDashboardMarketMoversInput): Promise<{
    topTradingValue: DashboardMarketMoverPayload[];
    topVolume: DashboardMarketMoverPayload[];
    gainers: DashboardMarketMoverPayload[];
    losers: DashboardMarketMoverPayload[];
  }> {
    return this.opts.delegate.fetchDashboardMarketMovers(input);
  }

  placeOrder(input: PlaceOrderInput): Promise<OrderAckModel> {
    return this.opts.delegate.placeOrder(input);
  }

  placeOrderForAccount(accountId: number, input: PlaceOrderInput): Promise<OrderAckModel> {
    return this.opts.delegate.placeOrderForAccount(accountId, input);
  }

  placeOrderForAccountCredential(
    accountId: number,
    apiCredentialId: number,
    accountExternalId: string,
    input: PlaceOrderInput,
  ): Promise<OrderAckModel> {
    return this.opts.delegate.placeOrderForAccountCredential(
      accountId,
      apiCredentialId,
      accountExternalId,
      input,
    );
  }

  cancelOrder(input: CancelOrderInput): Promise<OrderAckModel> {
    return this.opts.delegate.cancelOrder(input);
  }

  cancelOrderForAccount(
    accountId: number,
    accountExternalId: string,
    externalOrderId: string,
    symbol?: string,
    quantity?: number,
  ): Promise<OrderAckModel> {
    return this.opts.delegate.cancelOrderForAccount(
      accountId,
      accountExternalId,
      externalOrderId,
      symbol,
      quantity,
    );
  }

  cancelOrderForAccountCredential(
    accountId: number,
    apiCredentialId: number,
    accountExternalId: string,
    externalOrderId: string,
    symbol?: string,
    quantity?: number,
  ): Promise<OrderAckModel> {
    return this.opts.delegate.cancelOrderForAccountCredential(
      accountId,
      apiCredentialId,
      accountExternalId,
      externalOrderId,
      symbol,
      quantity,
    );
  }

  modifyOrder(input: ModifyOrderInput): Promise<OrderAckModel> {
    return this.opts.delegate.modifyOrder(input);
  }

  modifyOrderForAccount(accountId: number, input: ModifyOrderInput): Promise<OrderAckModel> {
    return this.opts.delegate.modifyOrderForAccount(accountId, input);
  }

  async connectMarketDataStream(handler: MarketDataFrameHandler): Promise<void> {
    this.handler = handler;

    await this.ensureChildren();
  }

  async disconnectMarketDataStream(): Promise<void> {
    await Promise.all(
      Array.from(this.children.values()).map((child) => child.vendor.disconnectMarketDataStream()),
    );

    this.children.clear();
    this.handler = null;
    this.lastCapDroppedSymbols = [];
  }

  async reconnectMarketDataStream(): Promise<void> {
    if (!this.handler) {
      throw new DomainError(
        'collector WS fanout cannot reconnect before initial connect',
        'COLLECTOR_WS_FANOUT_HANDLER_MISSING',
      );
    }

    const previousSymbols = normalizeSymbols(
      Array.from(this.children.values()).flatMap((child) => [...child.symbols]),
    );
    const previousMarketIndexes = previousSymbols.filter((symbol) =>
      MARKET_INDEX_SYMBOLS.has(symbol),
    );
    const previousChartSymbols = previousSymbols.filter(
      (symbol) => !MARKET_INDEX_SYMBOLS.has(symbol),
    );

    await Promise.all(
      Array.from(this.children.values()).map((child) => child.vendor.disconnectMarketDataStream()),
    );
    this.children.clear();

    await this.ensureChildren();

    const marketIndexSymbols =
      previousMarketIndexes.length > 0 ? previousMarketIndexes : DEFAULT_MARKET_INDEX_SYMBOLS;

    await this.subscribeMarketData({
      symbols: marketIndexSymbols,
      kinds: ['market-index'],
    });
    await this.subscribeMarketData({
      symbols: marketIndexSymbols,
      kinds: ['market-breadth'],
    });

    if (previousChartSymbols.length > 0) {
      await this.rebalanceMarketData({
        symbols: previousChartSymbols,
        kinds: this.lastKinds,
      });
    }
  }

  isMarketDataStreamConnected(): boolean {
    return this.children.size > 0 && Array.from(this.children.values()).some((child) =>
      child.vendor.isMarketDataStreamConnected(),
    );
  }

  async subscribeMarketData(input: SubscribeMarketDataInput): Promise<MarketDataSubscription> {
    this.lastKinds = input.kinds;
    await this.ensureChildren();

    const requestedSymbols = normalizeSymbols(input.symbols);
    const owned = this.currentOwnedSymbols();
    const existingSymbols = requestedSymbols.filter((symbol) => owned.has(symbol));
    const newSymbols = requestedSymbols.filter((symbol) => !owned.has(symbol));
    const capDropped: string[] = [];
    const byChild = this.partition(
      newSymbols,
      this.currentSymbolLoads(),
      this.currentSymbolLimits(),
      capDropped,
    );
    this.recordCapDropped(capDropped);

    await Promise.all([
      ...Array.from(this.children.values()).map(async (child) => {
        const symbols = existingSymbols.filter((symbol) => child.symbols.has(symbol));
        if (symbols.length === 0) return;

        await child.vendor.subscribeMarketData({ symbols, kinds: input.kinds });
      }),
      ...Array.from(byChild.entries()).map(async ([credentialId, symbols]) => {
        const child = this.children.get(credentialId);
        if (!child || symbols.length === 0) return;

        await child.vendor.subscribeMarketData({ symbols, kinds: input.kinds });
        for (const symbol of symbols) child.symbols.add(symbol);
      }),
    ]);

    return {
      subscribedSymbols: Array.from(new Set(Array.from(this.children.values()).flatMap((child) => [...child.symbols]))),
      unsubscribe: (unsubInput) =>
        this.unsubscribeMarketData(unsubInput ?? { symbols: input.symbols, kinds: input.kinds }),
    };
  }

  async rebalanceMarketData(input: SubscribeMarketDataInput): Promise<void> {
    this.lastKinds = input.kinds;
    await this.ensureChildren();

    const scopedSymbols = new Set(input.symbols);
    const baseLoads = this.currentSymbolLoads((symbol) => MARKET_INDEX_SYMBOLS.has(symbol));
    const capDropped: string[] = [];
    const byChild = this.partition(input.symbols, baseLoads, this.currentSymbolLimits(), capDropped);
    this.recordCapDropped(capDropped);

    await Promise.all(
      Array.from(this.children.values()).map(async (child) => {
        const desired = new Set(byChild.get(child.credentialId) ?? []);
        const currentInScope = [...child.symbols].filter(
          (symbol) => scopedSymbols.has(symbol) || !MARKET_INDEX_SYMBOLS.has(symbol),
        );
        const remove = currentInScope.filter((symbol) => !desired.has(symbol));
        const add = [...desired].filter((symbol) => !child.symbols.has(symbol));

        if (remove.length > 0) {
          await child.vendor.unsubscribeMarketData({ symbols: remove, kinds: input.kinds });
          for (const symbol of remove) child.symbols.delete(symbol);
        }

        if (add.length > 0) {
          await child.vendor.subscribeMarketData({ symbols: add, kinds: input.kinds });
          for (const symbol of add) child.symbols.add(symbol);
        }
      }),
    );
  }

  async unsubscribeMarketData(input: UnsubscribeMarketDataInput): Promise<void> {
    const kinds = input.kinds ?? this.lastKinds;
    const symbols = new Set(input.symbols);

    await Promise.all(
      Array.from(this.children.values()).map(async (child) => {
        const owned = [...child.symbols].filter((symbol) => symbols.has(symbol));
        if (owned.length === 0) return;

        await child.vendor.unsubscribeMarketData({ symbols: owned, kinds });

        for (const symbol of owned) child.symbols.delete(symbol);
      }),
    );
  }

  marketDataCapDroppedSymbols(): readonly string[] {
    return [...this.lastCapDroppedSymbols];
  }

  private async ensureChildren(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = this.doEnsureChildren().finally(() => {
        this.ensurePromise = null;
      });
    }

    return this.ensurePromise;
  }

  private async doEnsureChildren(): Promise<void> {
    if (!this.handler) return;

    const now = Date.now();
    const materials = await this.opts.source.listCollectorCredentials(
      Brokerage.Kiwoom,
      this.marketEnv(),
      'WS',
    );
    const activeIds = new Set(materials.map((material) => material.credentialId));

    for (const [credentialId, child] of this.children) {
      if (activeIds.has(credentialId)) continue;

      await child.vendor.disconnectMarketDataStream().catch((err) => {
        this.logger.warn(
          `collector WS fanout disconnect failed credentialId=${credentialId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
      this.children.delete(credentialId);
      this.logger.warn(`collector WS fanout removed credentialId=${credentialId}`);
    }

    for (const material of materials) {
      if (this.children.has(material.credentialId)) continue;
      const backoffUntil = this.connectBackoffUntil.get(material.credentialId);
      if (backoffUntil && backoffUntil > now) continue;
      if (backoffUntil && backoffUntil <= now) this.connectBackoffUntil.delete(material.credentialId);

      const tokenSupplier = async () => ({
        token: await this.opts.tokenCache.getAccessToken(material),
        credential: { kind: 'collector' as const, credentialId: material.credentialId },
        invalidate: () => this.opts.tokenCache.invalidate(material.credentialId),
      });
      const vendor = new KiwoomBrokerageVendor({
        profile: 'collector',
        apiClient: this.opts.apiClient,
        wsClient: new KiwoomWsClient({
          profile: 'collector',
          wsUrl: this.opts.config.wsUrl,
          tokenSupplier,
        }),
        tokenSupplier,
        usage: this.opts.usage,
        collectorRuntimeState: this.opts.collectorRuntimeState,
        invalidateToken: () => this.opts.tokenCache.invalidate(material.credentialId),
        reconnect: { enabled: true },
      });

      try {
        await vendor.connectMarketDataStream((frame) => this.handler?.(frame));
      } catch (err) {
        this.logger.warn(
          `collector WS fanout connect failed credentialId=${material.credentialId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        this.connectBackoffUntil.set(material.credentialId, Date.now() + CONNECT_FAILURE_BACKOFF_MS);

        continue;
      }

      this.connectBackoffUntil.delete(material.credentialId);
      this.children.set(material.credentialId, {
        credentialId: material.credentialId,
        vendor,
        symbols: new Set(),
        wsMaxSymbols: material.wsMaxSymbols ?? DEFAULT_WS_MAX_SYMBOLS,
      });
      this.logger.log(`collector WS fanout added credentialId=${material.credentialId}`);
    }

    if (this.children.size === 0) {
      throw new DomainError(
        'collector WS fanout could not connect any eligible credential',
        'COLLECTOR_WS_FANOUT_EMPTY',
        { candidates: materials.length },
      );
    }
  }

  private partition(
    symbols: readonly string[],
    baseLoads: ReadonlyMap<number, number> = new Map(),
    limits: ReadonlyMap<number, number | null> = new Map(),
    capDropped: string[] = [],
  ): Map<number, string[]> {
    const credentialIds = Array.from(this.children.keys()).sort((a, b) => a - b);
    const result = new Map<number, string[]>();
    const loads = new Map<number, number>();

    for (const credentialId of credentialIds) {
      result.set(credentialId, []);
      loads.set(credentialId, baseLoads.get(credentialId) ?? 0);
    }
    if (credentialIds.length === 0) return result;

    for (const symbol of normalizeSymbols(symbols)) {
      const credentialId = leastLoadedOwnerFor(symbol, credentialIds, loads, limits);
      if (credentialId === null) {
        capDropped.push(symbol);
        continue;
      }

      result.get(credentialId)?.push(symbol);
      loads.set(credentialId, (loads.get(credentialId) ?? 0) + 1);
    }

    return result;
  }

  private recordCapDropped(symbols: readonly string[]): void {
    this.lastCapDroppedSymbols = normalizeSymbols(symbols);
    if (this.lastCapDroppedSymbols.length === 0) return;

    this.logger.warn(
      `collector WS fanout cap saturated; dropped=${this.lastCapDroppedSymbols.length} sample=${this.lastCapDroppedSymbols
        .slice(0, 10)
        .join(',')}`,
    );
  }

  private currentOwnedSymbols(): Set<string> {
    return new Set(Array.from(this.children.values()).flatMap((child) => [...child.symbols]));
  }

  private currentSymbolLoads(predicate: (symbol: string) => boolean = () => true): Map<number, number> {
    const loads = new Map<number, number>();

    for (const child of this.children.values()) {
      loads.set(
        child.credentialId,
        [...child.symbols].filter((symbol) => predicate(symbol)).length,
      );
    }

    return loads;
  }

  private currentSymbolLimits(): Map<number, number | null> {
    return new Map(
      Array.from(this.children.values()).map((child) => [
        child.credentialId,
        child.wsMaxSymbols,
      ]),
    );
  }

  private marketEnv(): MarketEnv {
    return this.opts.config.marketEnv === 'mock' ? MarketEnv.Mock : MarketEnv.Production;
  }
}

function leastLoadedOwnerFor(
  symbol: string,
  credentialIds: readonly number[],
  loads: ReadonlyMap<number, number>,
  limits: ReadonlyMap<number, number | null>,
): number | null {
  const available = credentialIds.filter((credentialId) => {
    const limit = limits.get(credentialId);

    return limit === null || limit === undefined || (loads.get(credentialId) ?? 0) < limit;
  });
  if (available.length === 0) return null;
  const minLoad = Math.min(
    ...available.map((credentialId) => loads.get(credentialId) ?? 0),
  );
  const candidates = available.filter(
    (credentialId) => (loads.get(credentialId) ?? 0) === minLoad,
  );

  return rendezvousOwnerFor(symbol, candidates);
}

function rendezvousOwnerFor(symbol: string, credentialIds: readonly number[]): number {
  let best = credentialIds[0];
  let bestScore = -1;

  for (const credentialId of credentialIds) {
    const score = fnv1a32(`${symbol}:${credentialId}`);
    if (score > bestScore) {
      best = credentialId;
      bestScore = score;
    }
  }

  return best;
}

function normalizeSymbols(symbols: readonly string[]): string[] {
  return Array.from(new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))).sort();
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }

  return hash >>> 0;
}
