import { Global, Module, type Provider } from '@nestjs/common';
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
import { CredentialSourceService } from './credential/credential-source.service';
import { BrokerageVendorResolver } from './service/brokerage-vendor.resolver';
import { RateLimiter } from './service/rate-limiter.service';
import { KiwoomTokenService } from './platforms/kiwoom/auth/kiwoom-token.service';
import { KiwoomApiClient } from './platforms/kiwoom/kiwoom.api-client';
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
): KiwoomBrokerageVendor {
  let cachedCredentialId: number | null = null;

  const collectorTokenSupplier = async (): Promise<string> => {
    // Collector profile: resolve marketEnv from KIWOOM_MARKET_ENV. The
    // lowercase value lives on KiwoomConfig; convert to the DB enum form.
    const dbMarketEnv =
      config.marketEnv === 'mock' ? MarketEnv.Mock : MarketEnv.Production;

    const material = await source.selectCollectorCredential(Brokerage.Kiwoom, dbMarketEnv);

    cachedCredentialId = material.credentialId;

    return tokenCache.getAccessToken(material);
  };

  const executorTokenSupplier = async (): Promise<string> => {
    // Executor profile without an accountId would be a bug — every
    // executor call goes through placeOrderForAccount which sets up a
    // per-call supplier. The default path here exists only so admin
    // probe / generic WS LOGIN have a fallback (collector pool). The
    // gateway.assertProfile guard on placeOrder() prevents accidental
    // collector use on this gateway, so falling back to collector pool
    // here is safe (probe path only).
    const dbMarketEnv =
      config.marketEnv === 'mock' ? MarketEnv.Mock : MarketEnv.Production;

    const material = await source.selectCollectorCredential(Brokerage.Kiwoom, dbMarketEnv);

    cachedCredentialId = material.credentialId;

    return tokenCache.getAccessToken(material);
  };

  const tokenSupplier = profile === 'collector' ? collectorTokenSupplier : executorTokenSupplier;

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
    tokenSupplier,
    rateLimiter,
  });

  const wsClient = new KiwoomWsClient({
    profile,
    wsUrl: config.wsUrl,
    tokenSupplier,
  });

  return new KiwoomBrokerageVendor({
    profile,
    apiClient,
    wsClient,
    tokenSupplier,
    invalidateToken: () => {
      // After repeated LOGIN failures the gateway calls this so the
      // cached bundle for the credential most recently used by the
      // supplier is dropped. cachedCredentialId is best-effort —
      // concurrent suppliers can race, but a stale id at worst
      // invalidates a different credential which will just re-issue.
      if (cachedCredentialId !== null) tokenCache.invalidate(cachedCredentialId);
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
  ],
  useFactory: (
    config: KiwoomConfig,
    tokenService: KiwoomTokenService,
    tokenCache: AccessTokenCacheService,
    source: CredentialSourceService,
  ) => buildKiwoomGateway(config, 'collector', tokenService, tokenCache, source),
};

const executorGatewayProvider: Provider = {
  provide: EXECUTOR_BROKERAGE_VENDOR,
  inject: [
    KIWOOM_CONFIG,
    KiwoomTokenService,
    AccessTokenCacheService,
    CredentialSourceService,
  ],
  useFactory: (
    config: KiwoomConfig,
    tokenService: KiwoomTokenService,
    tokenCache: AccessTokenCacheService,
    source: CredentialSourceService,
  ) => buildKiwoomGateway(config, 'executor', tokenService, tokenCache, source),
};

@Global()
@Module({
  providers: [
    CredentialCooldownService,
    CredentialSourceService,
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
  ],
})
export class BrokerageModule {}
