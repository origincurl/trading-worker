import { Inject, Injectable } from '@nestjs/common';
import {
  BE_CONTROL_PLANE_CLIENT,
  type BeControlPlaneClient,
} from '@external/be-control-plane/client/be-control-plane.client';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import {
  CredentialTarget,
  type TestCredentialsRequestDto,
  type TestCredentialsResponseDto,
} from '@admin/dto/test-credentials.dto';

// Phase 10: lightweight credential probe. Each probe surface-checks
// the configuration that the named target requires and returns a
// pass/fail flag. Real /oauth2/token issuance lands with Phase 6.8 —
// for now the kiwoom probes assert the env vars are non-empty.
@Injectable()
export class TestCredentialsUsecase {
  constructor(
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    @Inject(BE_CONTROL_PLANE_CLIENT) private readonly be: BeControlPlaneClient,
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

  private probeKiwoom(profile: 'collector' | 'executor'): TestCredentialsResponseDto {
    const cred = profile === 'collector' ? this.kiwoom.collector : this.kiwoom.executor;

    if (!cred?.appKey || !cred.appSecret) {
      return { ok: false, detail: `${profile} app key/secret unset` };
    }

    if (!this.kiwoom.accessToken) {
      return { ok: false, detail: `${profile} access token unset (Phase 6.8 adds refresh)` };
    }

    return { ok: true, detail: `${profile} key + token present` };
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
