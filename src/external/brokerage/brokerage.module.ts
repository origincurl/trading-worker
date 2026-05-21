import { Global, Module, type Provider } from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { Brokerage } from '@shared/model/account/brokerage.enum';
import { MarketEnv } from '@shared/model/api-credential/market-env.enum';
import { AccessTokenCacheService } from './auth/access-token-cache.service';
import {
  COLLECTOR_BROKERAGE_VENDOR,
  EXECUTOR_BROKERAGE_VENDOR,
  type BrokerageVendorProfile,
} from './brokerage.token';
import { CredentialCooldownService } from './credential/credential-cooldown.service';
import type { BrokerageCredentialMaterial } from './credential/brokerage-credential-material';
import { CredentialSourceService } from './credential/credential-source.service';
import { CredentialUsageService } from './credential/credential-usage.service';
import { BrokerageVendorResolver } from './service/brokerage-vendor.resolver';
import { RateLimiter } from './service/rate-limiter.service';
import { KiwoomTokenService } from './platforms/kiwoom/auth/kiwoom-token.service';
import { KiwoomApiClient, type KiwoomTokenResult } from './platforms/kiwoom/kiwoom.api-client';
import { KiwoomBrokerageVendor } from './platforms/kiwoom/kiwoom-brokerage.vendor';
import { KiwoomWsClient } from './platforms/kiwoom/kiwoom-ws.client';

// Phase C: per architecture.md §10, collector and executor MUST receive
// distinct gateway instances backed by distinct credential pools. The
// factories no longer read appKey/appSecret from env — both pull from
// CredentialSourceService at request time so credential rotation in the
// DB takes effect without a worker restart.
//
// Collector profile binds a supplier that selects from
// collector_credentials (market-data pool). Executor profile binds a
// supplier that requires an accountId — placeOrderForAccount captures
// it via the per-call wrapper below.
function buildKiwoomGateway(
  config: KiwoomConfig,
  profile: BrokerageVendorProfile,
  tokenService: KiwoomTokenService,
  tokenCache: AccessTokenCacheService,
  source: CredentialSourceService,
  usage: CredentialUsageService,
): KiwoomBrokerageVendor {
  let lastWsCredentialId: number | null = null;
  let stickyCollectorWsMaterial: BrokerageCredentialMaterial | null = null;

  const collectorMarketEnv = (): MarketEnv =>
    config.marketEnv === 'mock' ? MarketEnv.Mock : MarketEnv.Production;

  const collectorRestTokenSupplier = async (): Promise<KiwoomTokenResult> => {
    const material = await source.selectCollectorCredential(Brokerage.Kiwoom, collectorMarketEnv());

    const token = await tokenCache.getAccessToken(material);

    return {
      token,
      credential: { kind: 'collector', credentialId: material.credentialId },
    };
  };

  const collectorWsTokenSupplier = async (): Promise<KiwoomTokenResult> => {
    if (!stickyCollectorWsMaterial) {
      stickyCollectorWsMaterial = await source.selectCollectorCredential(Brokerage.Kiwoom, collectorMarketEnv());
    }

    const material = stickyCollectorWsMaterial;
    lastWsCredentialId = material.credentialId;

    try {
      const token = await tokenCache.getAccessToken(material);

      return {
        token,
        credential: { kind: 'collector', credentialId: material.credentialId },
      };
    } catch (err) {
      if (stickyCollectorWsMaterial?.credentialId === material.credentialId) {
        stickyCollectorWsMaterial = null;
      }

      throw err;
    }
  };

  const executorTokenSupplier = async (): Promise<KiwoomTokenResult> => {
    throw new DomainError(
      'executor credential resolution requires an accountId',
      'EXECUTOR_ACCOUNT_ID_REQUIRED',
      { profile },
    );
  };

  const accountTokenSupplier = async (accountId: number): Promise<KiwoomTokenResult> => {
    const material = await source.selectAccountCredential(accountId);

    const token = await tokenCache.getAccessToken(material);

    return {
      token,
      credential: {
        kind: 'executor',
        credentialId: material.credentialId,
        accountId,
      },
    };
  };

  const apiTokenSupplier = profile === 'collector' ? collectorRestTokenSupplier : executorTokenSupplier;
  const wsTokenSupplier = profile === 'collector' ? collectorWsTokenSupplier : executorTokenSupplier;

  const rateLimiter = new RateLimiter({
    name: `kiwoom.${profile}`,
    capacity: profile === 'executor' ? 5 : 20,
    refillPerSecond: profile === 'executor' ? 5 : 10,
    maxConcurrent: profile === 'executor' ? 4 : 8,
    waitOnExhaustion: false,
  });

  const apiClient = new KiwoomApiClient({
    profile,
    restUrl: config.restUrl,
    tokenSupplier: apiTokenSupplier,
    rateLimiter,
    usage,
  });

  const wsClient = new KiwoomWsClient({
    profile,
    wsUrl: config.wsUrl,
    tokenSupplier: wsTokenSupplier,
  });

  return new KiwoomBrokerageVendor({
    profile,
    apiClient,
    wsClient,
    tokenSupplier: wsTokenSupplier,
    accountTokenSupplier: profile === 'executor' ? accountTokenSupplier : undefined,
    usage,
    invalidateToken: () => {
      // After repeated LOGIN failures the gateway invalidates only the
      // credential last used by the WS supplier. REST/account suppliers
      // intentionally do not update this id.
      if (lastWsCredentialId !== null) {
        tokenCache.invalidate(lastWsCredentialId);
        if (stickyCollectorWsMaterial?.credentialId === lastWsCredentialId) {
          stickyCollectorWsMaterial = null;
        }
      }
    },
    reconnect: { enabled: true },
  });
}

const collectorGatewayProvider: Provider = {
  provide: COLLECTOR_BROKERAGE_VENDOR,
  inject: [
    KIWOOM_CONFIG,
    KiwoomTokenService,
    AccessTokenCacheService,
    CredentialSourceService,
    CredentialUsageService,
  ],
  useFactory: (
    config: KiwoomConfig,
    tokenService: KiwoomTokenService,
    tokenCache: AccessTokenCacheService,
    source: CredentialSourceService,
    usage: CredentialUsageService,
  ) => buildKiwoomGateway(config, 'collector', tokenService, tokenCache, source, usage),
};

const executorGatewayProvider: Provider = {
  provide: EXECUTOR_BROKERAGE_VENDOR,
  inject: [
    KIWOOM_CONFIG,
    KiwoomTokenService,
    AccessTokenCacheService,
    CredentialSourceService,
    CredentialUsageService,
  ],
  useFactory: (
    config: KiwoomConfig,
    tokenService: KiwoomTokenService,
    tokenCache: AccessTokenCacheService,
    source: CredentialSourceService,
    usage: CredentialUsageService,
  ) => buildKiwoomGateway(config, 'executor', tokenService, tokenCache, source, usage),
};

@Global()
@Module({
  providers: [
    CredentialCooldownService,
    CredentialSourceService,
    CredentialUsageService,
    KiwoomTokenService,
    AccessTokenCacheService,
    collectorGatewayProvider,
    executorGatewayProvider,
    BrokerageVendorResolver,
  ],
  exports: [
    COLLECTOR_BROKERAGE_VENDOR,
    EXECUTOR_BROKERAGE_VENDOR,
    BrokerageVendorResolver,
    CredentialSourceService,
    AccessTokenCacheService,
    CredentialCooldownService,
    CredentialUsageService,
  ],
})
export class BrokerageModule {}
