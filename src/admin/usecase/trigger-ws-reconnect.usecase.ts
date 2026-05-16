import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RUNTIME_CONFIG, type RuntimeConfig, type WorkerRole } from '@config/runtime.config';
import {
  COLLECTOR_BROKERAGE_GATEWAY,
  EXECUTOR_BROKERAGE_GATEWAY,
} from '@external/brokerage/brokerage.token';
import type { BrokerageGateway } from '@external/brokerage/gateway/brokerage.gateway';
import {
  WsReconnectProfile,
  type WsReconnectRequestDto,
  type WsReconnectResponseDto,
} from '@admin/dto/ws-reconnect.dto';

// Disconnects the requested profile's WS. The Phase 6.8 reconnect
// orchestrator picks up the close event and reconnects with backoff —
// we never call connect() ourselves so the operator triggers a clean,
// gateway-supervised re-establishment.
//
// Both gateway tokens are @Optional() because AdminModule is loaded
// regardless of ROLES; BrokerageModule is only pulled in by collector
// or executor role modules. With ROLES=detector|calculator the tokens
// are absent and admin reconnect for those profiles returns a not-loaded
// detail.
@Injectable()
export class TriggerWsReconnectUsecase {
  private readonly logger = new Logger(TriggerWsReconnectUsecase.name);

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    @Optional() @Inject(COLLECTOR_BROKERAGE_GATEWAY) private readonly collector?: BrokerageGateway,
    @Optional() @Inject(EXECUTOR_BROKERAGE_GATEWAY) private readonly executor?: BrokerageGateway,
  ) {}

  async execute(input: WsReconnectRequestDto): Promise<WsReconnectResponseDto> {
    const role: WorkerRole =
      input.profile === WsReconnectProfile.Collector ? 'collector' : 'executor';

    if (!this.runtime.roles.includes(role)) {
      return { triggered: false, detail: `role=${role} not active in this worker` };
    }

    const gateway = input.profile === WsReconnectProfile.Collector ? this.collector : this.executor;

    if (!gateway) {
      return {
        triggered: false,
        detail: `${input.profile} brokerage gateway not loaded — BrokerageModule absent`,
      };
    }

    try {
      await gateway.disconnectMarketDataStream();

      this.logger.log(`ws disconnect requested for profile=${input.profile}`);

      return {
        triggered: true,
        detail: 'disconnect issued — reconnect orchestrator will recover',
      };
    } catch (err) {
      return {
        triggered: false,
        detail: `disconnect failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
