import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { EXECUTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import { dispatchExecutionFrame } from '@roles/tracker/mapper/kiwoom-order-fill.event-mapper';
import { IngestExecutionUsecase } from '@roles/tracker/usecase/ingest-execution.usecase';

// Subscribes the tracker's WS pipe to vendor execution frames. Reuses the
// EXECUTOR_BROKERAGE_VENDOR token (account-scoped credential pool — see
// phase/06-worker-tracker.md §4) so balance/position/execution traffic
// share the same per-account vendor budget. The token name remains
// EXECUTOR_BROKERAGE_VENDOR for now (Phase 9 may rename to
// ACCOUNT_BROKERAGE_GATEWAY). Currently subscribes 0-symbol (Kiwoom WS
// publishes all account-owned executions on connect).
@Injectable()
export class KiwoomExecutionSubscriber implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(KiwoomExecutionSubscriber.name);

  private _connected = false;

  constructor(
    @Inject(EXECUTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    private readonly usecase: IngestExecutionUsecase,
  ) {}

  isConnected(): boolean {
    return this._connected;
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.gateway.connectMarketDataStream((frame) => this.handleFrame(frame));

      this._connected = true;

      this.logger.log('execution stream connected');
    } catch (err) {
      this._connected = false;

      this.logger.warn(
        `execution WS connect failed — tracker boots degraded: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this._connected) return;

    try {
      await this.gateway.disconnectMarketDataStream();
    } catch (err) {
      this.logger.warn(
        `execution WS disconnect failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    this._connected = false;
  }

  private handleFrame(frame: unknown): void {
    const results = dispatchExecutionFrame(frame, {
      marketEnv: this.kiwoom.marketEnv,
      receivedAt: new Date(),
    });

    for (const result of results) {
      if (result.kind === 'fill') {
        this.usecase
          .execute(result.payload)
          .catch((err) =>
            this.logger.warn(
              `order-fill ingest failed: ${err instanceof Error ? err.message : err}`,
            ),
          );
      } else if (result.kind === 'dead-letter') {
        this.logger.warn(
          `execution dead-letter type=${result.realtimeType ?? 'null'} reason=${result.reason}`,
        );
      }
    }
  }
}
