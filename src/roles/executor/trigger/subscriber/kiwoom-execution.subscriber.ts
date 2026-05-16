import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { EXECUTOR_BROKERAGE_GATEWAY } from '@external/brokerage/brokerage.token';
import type { BrokerageGateway } from '@external/brokerage/gateway/brokerage.gateway';
import { dispatchExecutionFrame } from '@roles/executor/mapper/kiwoom-order-fill.event-mapper';
import { IngestOrderFillUsecase } from '@roles/executor/usecase/ingest-order-fill.usecase';

// Subscribes the executor's WS pipe to vendor execution frames. Phase 8
// uses the same brokerage gateway abstraction as collector but with the
// EXECUTOR_BROKERAGE_GATEWAY token so the order rate-limit budget stays
// disjoint. Currently subscribes 0-symbol (vendor publishes all account-
// owned executions on connect for Kiwoom).
@Injectable()
export class KiwoomExecutionSubscriber implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(KiwoomExecutionSubscriber.name);

  private _connected = false;

  constructor(
    @Inject(EXECUTOR_BROKERAGE_GATEWAY) private readonly gateway: BrokerageGateway,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    private readonly usecase: IngestOrderFillUsecase,
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
        `execution WS connect failed — executor boots degraded: ${err instanceof Error ? err.message : err}`,
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
