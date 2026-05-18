import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  COLLECTOR_BROKERAGE_VENDOR,
  EXECUTOR_BROKERAGE_VENDOR,
} from '@external/brokerage/brokerage.token';
import type { KiwoomBrokerageVendor } from '@external/brokerage/platforms/kiwoom/kiwoom-brokerage.vendor';
import {
  CredentialTarget,
  type TestCredentialsRequestDto,
  type TestCredentialsResponseDto,
} from '@admin/dto/test-credentials.dto';

// Live credential probe. Phase F: BE control-plane probe removed — the
// worker is self-sufficient now. For Kiwoom profiles we exercise the
// real /oauth2/token call via the gateway, which surfaces vendor-side
// issues (revoked key, wrong secret, network problems) instead of just
// checking env presence.
@Injectable()
export class TestCredentialsUsecase {
  constructor(
    @Optional()
    @Inject(COLLECTOR_BROKERAGE_VENDOR)
    private readonly collectorGateway?: KiwoomBrokerageVendor,
    @Optional()
    @Inject(EXECUTOR_BROKERAGE_VENDOR)
    private readonly executorGateway?: KiwoomBrokerageVendor,
  ) {}

  async execute(input: TestCredentialsRequestDto): Promise<TestCredentialsResponseDto> {
    switch (input.target) {
      case CredentialTarget.KiwoomCollector:
        return this.probeKiwoom('collector');

      case CredentialTarget.KiwoomExecutor:
        return this.probeKiwoom('executor');
    }
  }

  private async probeKiwoom(
    profile: 'collector' | 'executor',
  ): Promise<TestCredentialsResponseDto> {
    const gateway = profile === 'collector' ? this.collectorGateway : this.executorGateway;

    if (!gateway) {
      return {
        ok: false,
        detail: `${profile} brokerage gateway not loaded — BrokerageModule absent (role not active?)`,
      };
    }

    try {
      const token = await gateway.probeAccessToken();

      // Never log or surface the token. Length is enough to confirm
      // the call returned something non-empty.
      return { ok: true, detail: `${profile} /oauth2/token OK (length=${token.length})` };
    } catch (err) {
      return {
        ok: false,
        detail: `${profile} /oauth2/token failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
