import { Inject, Injectable, Optional } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import {
  BE_CONTROL_PLANE_CLIENT,
  type BeControlPlaneClient,
} from '@external/be-control-plane/client/be-control-plane.client';
import {
  COLLECTOR_BROKERAGE_GATEWAY,
  EXECUTOR_BROKERAGE_GATEWAY,
} from '@external/brokerage/brokerage.token';
import type { KiwoomBrokerageGateway } from '@external/brokerage/vendors/kiwoom/kiwoom-brokerage.gateway';
import {
  CredentialTarget,
  type TestCredentialsRequestDto,
  type TestCredentialsResponseDto,
} from '@admin/dto/test-credentials.dto';

// Live credential probe. For Kiwoom profiles we exercise the real
// /oauth2/token call via the gateway's tokenService — that surfaces
// vendor-side issues (revoked key, wrong secret, network problems)
// instead of just checking env presence.
@Injectable()
export class TestCredentialsUsecase {
  constructor(
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    @Inject(BE_CONTROL_PLANE_CLIENT) private readonly be: BeControlPlaneClient,
    @Optional()
    @Inject(COLLECTOR_BROKERAGE_GATEWAY)
    private readonly collectorGateway?: KiwoomBrokerageGateway,
    @Optional()
    @Inject(EXECUTOR_BROKERAGE_GATEWAY)
    private readonly executorGateway?: KiwoomBrokerageGateway,
  ) {}

  async execute(input: TestCredentialsRequestDto): Promise<TestCredentialsResponseDto> {
    switch (input.target) {
      case CredentialTarget.KiwoomCollector:
        return this.probeKiwoom('collector');

      case CredentialTarget.KiwoomExecutor:
        return this.probeKiwoom('executor');

      case CredentialTarget.BeControlPlane:
        return this.probeBe();
    }
  }

  private async probeKiwoom(
    profile: 'collector' | 'executor',
  ): Promise<TestCredentialsResponseDto> {
    const cred = profile === 'collector' ? this.kiwoom.collector : this.kiwoom.executor;

    if (!cred?.appKey || !cred.appSecret) {
      return { ok: false, detail: `${profile} app key/secret unset` };
    }

    const gateway = profile === 'collector' ? this.collectorGateway : this.executorGateway;

    if (!gateway) {
      return {
        ok: false,
        detail: `${profile} brokerage gateway not loaded — BrokerageModule absent (role not active?)`,
      };
    }

    try {
      const token = await gateway.tokenService.getAccessToken();

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

  private async probeBe(): Promise<TestCredentialsResponseDto> {
    // Smallest call we can make to BE: rate-limit acquire with tokens=0.
    // Mock client always returns success — production hits HMAC pipeline.
    try {
      const r = await this.be.acquireRateLimit({ endpoint: '/admin/probe', tokens: 0 });

      if (r.kind === 'success') return { ok: true, detail: 'BE reachable + HMAC accepted' };

      return { ok: false, detail: `BE returned kind=${r.kind}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
