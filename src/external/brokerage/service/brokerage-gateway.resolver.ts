import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import {
  COLLECTOR_BROKERAGE_GATEWAY,
  EXECUTOR_BROKERAGE_GATEWAY,
  type BrokerageGatewayProfile,
} from '../brokerage.token';
import type { BrokerageGateway } from '../gateway/brokerage.gateway';

// Single-vendor (Kiwoom) world today. The resolver exists so role code can
// stay vendor-agnostic — when a second vendor lands, this routes on
// `(provider, profile)` instead of just `profile`, without changing call
// sites in roles/.
@Injectable()
export class BrokerageGatewayResolver {
  constructor(
    @Inject(COLLECTOR_BROKERAGE_GATEWAY) private readonly collectorGateway: BrokerageGateway,
    @Inject(EXECUTOR_BROKERAGE_GATEWAY) private readonly executorGateway: BrokerageGateway,
  ) {}

  forProfile(profile: BrokerageGatewayProfile): BrokerageGateway {
    if (profile === 'collector') return this.collectorGateway;

    if (profile === 'executor') return this.executorGateway;

    throw new DomainError(
      `unknown brokerage gateway profile: ${profile as string}`,
      'BROKERAGE_PROFILE_UNKNOWN',
    );
  }
}
