import { Logger } from '@nestjs/common';
import { IntegrationError, NotImplementedError } from '@common/error/domain.error';
import type { BrokerageGatewayProfile } from '../../brokerage.token';
import type { RateLimiter } from '../../service/rate-limiter.service';
import type { KiwoomTokenService } from './auth/kiwoom-token.service';

export interface KiwoomApiClientOptions {
  readonly profile: BrokerageGatewayProfile;
  readonly restUrl?: string;
  readonly tokenService: KiwoomTokenService;
  readonly rateLimiter: RateLimiter;
}

// Phase 3: surface area only. The real REST calls are added in Phase 6/8
// against the contract types in `./contract/`. Every call must go through
// rateLimiter.run(...) and tokenService.getAccessToken() — those two are
// the load-bearing invariants that keep collector and executor isolated.
export class KiwoomApiClient {
  private readonly logger: Logger;

  constructor(private readonly opts: KiwoomApiClientOptions) {
    this.logger = new Logger(`KiwoomApiClient[${opts.profile}]`);
  }

  get profile(): BrokerageGatewayProfile {
    return this.opts.profile;
  }

  // Single entry for all REST calls — concentrates rate-limit + auth in one place.
  async request<TRequest, TResponse>(apiId: string, body: TRequest): Promise<TResponse> {
    if (!this.opts.restUrl) {
      throw new IntegrationError('Kiwoom REST URL not configured', {
        profile: this.opts.profile,
        apiId,
      });
    }

    return this.opts.rateLimiter.run(async () => {
      const token = await this.opts.tokenService.getAccessToken();

      void token;

      void body;

      throw new NotImplementedError(`KiwoomApiClient.request(${apiId}) not implemented`, {
        profile: this.opts.profile,
        apiId,
      });
    });
  }
}
