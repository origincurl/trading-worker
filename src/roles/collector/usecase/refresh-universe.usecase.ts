import { Inject, Injectable, Logger } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { shouldHandle } from '@common/util/shard';
import {
  BE_CONTROL_PLANE_CLIENT,
  type BeControlPlaneClient,
} from '@external/be-control-plane/client/be-control-plane.client';
import { COLLECTOR_BROKERAGE_GATEWAY } from '@external/brokerage/brokerage.token';
import type {
  BrokerageGateway,
  MarketDataFrameKind,
} from '@external/brokerage/gateway/brokerage.gateway';
import { COLLECTOR_CONFIG, type CollectorConfig } from '@config/collector.config';
import { SubscriptionPlannerService } from '@roles/collector/service/subscription-planner.service';
import { UniverseService } from '@roles/collector/service/universe.service';

// Pulls a fresh universe lease from BE, applies it via UniverseService,
// then asks the planner to compute REG/REMOVE diff against currently
// subscribed symbols on the WS gateway. Tolerates BE failures (logs +
// keeps current universe) so vendor outage on BE never tears down the
// vendor WS pipe.
@Injectable()
export class RefreshUniverseUsecase {
  private readonly logger = new Logger(RefreshUniverseUsecase.name);

  private _lastRefreshAt: Date | null = null;

  private _lastRefreshOk = false;

  constructor(
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    @Inject(COLLECTOR_CONFIG) private readonly collectorConfig: CollectorConfig,
    @Inject(BE_CONTROL_PLANE_CLIENT) private readonly be: BeControlPlaneClient,
    @Inject(COLLECTOR_BROKERAGE_GATEWAY) private readonly gateway: BrokerageGateway,
    private readonly universe: UniverseService,
    private readonly planner: SubscriptionPlannerService,
  ) {}

  lastRefreshAt(): Date | null {
    return this._lastRefreshAt;
  }

  lastRefreshOk(): boolean {
    return this._lastRefreshOk;
  }

  async execute(): Promise<void> {
    this._lastRefreshAt = new Date();

    const knownVersion = this.universe.currentSnapshot()?.version;

    const result = await this.be.fetchUniverseLease({
      marketEnv: this.kiwoom.marketEnv,
      knownVersion,
    });

    if (result.kind !== 'success') {
      this._lastRefreshOk = false;

      this.logger.warn(`universe lease fetch failed: kind=${result.kind}`);

      return;
    }

    const applied = this.universe.apply(result.data);

    this._lastRefreshOk = true;

    if (!applied) return;

    // Snapshot changed — diff against gateway's current view, REG/REMOVE.
    const target = this.universe
      .currentSnapshot()!
      .symbols.map((s) => s.symbol)
      .filter((s) => shouldHandle(s, this.runtime.shardIndex, this.runtime.shardCount));

    if (!this.gateway.isMarketDataStreamConnected()) {
      this.logger.warn('gateway not connected — applying universe diff deferred');

      return;
    }

    const kinds: MarketDataFrameKind[] = ['trade-tick'];

    if (this.collectorConfig.subscribeOrderbook) kinds.push('orderbook');

    // Gateway tracks current subscriptions internally; planner needs to
    // know them. Without an exposed accessor we approximate by treating
    // each refresh as "subscribe the full target" — Kiwoom REG with
    // refresh=1 is idempotent. REMOVE for symbols not in target requires
    // the gateway to expose its set, which is a Phase 6.8 hardening.
    if (target.length > 0) {
      await this.gateway.subscribeMarketData({ symbols: target, kinds });

      this.logger.log(`universe applied: REG symbols=${target.length} kinds=[${kinds.join(',')}]`);
    }
  }
}
