import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import {
  COLLECTOR_BROKERAGE_VENDOR,
  EXECUTOR_BROKERAGE_VENDOR,
  type BrokerageVendorProfile,
} from '../brokerage.token';
import type { BrokerageVendor } from '../vendor/brokerage.vendor';

// Single-vendor (Kiwoom) world today. The resolver exists so role code can
// stay vendor-agnostic — when a second vendor lands, this routes on
// `(provider, profile)` instead of just `profile`, without changing call
// sites in roles/.
@Injectable()
export class BrokerageVendorResolver {
  constructor(
    @Inject(COLLECTOR_BROKERAGE_VENDOR) private readonly collectorGateway: BrokerageVendor,
    @Inject(EXECUTOR_BROKERAGE_VENDOR) private readonly executorGateway: BrokerageVendor,
  ) {}

  forProfile(profile: BrokerageVendorProfile): BrokerageVendor {
    if (profile === 'collector') return this.collectorGateway;

    if (profile === 'executor') return this.executorGateway;

    throw new DomainError(
      `unknown brokerage gateway profile: ${profile as string}`,
      'BROKERAGE_PROFILE_UNKNOWN',
    );
  }
}
