import { Global, Module, type Provider } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import {
  COLLECTOR_BROKERAGE_GATEWAY,
  EXECUTOR_BROKERAGE_GATEWAY,
  type BrokerageGatewayProfile,
} from './brokerage.token';
import { BrokerageGatewayResolver } from './service/brokerage-gateway.resolver';
import { RateLimiter } from './service/rate-limiter.service';
import { KiwoomTokenService } from './vendors/kiwoom/auth/kiwoom-token.service';
import { KiwoomApiClient } from './vendors/kiwoom/kiwoom.api-client';
import { KiwoomBrokerageGateway } from './vendors/kiwoom/kiwoom-brokerage.gateway';
import { KiwoomWsClient } from './vendors/kiwoom/kiwoom-ws.client';

// Per architecture.md §10: collector and executor MUST receive distinct
// gateway instances with distinct credentials. Disabled credentials (role
// inactive) collapse to a `forbidden` stub gateway so injecting the token
// in a wrong-role module produces a clear runtime error instead of silently
// using the other role's budget.
function buildKiwoomGateway(
  config: KiwoomConfig,
  profile: BrokerageGatewayProfile,
): KiwoomBrokerageGateway {
  const credentials = profile === 'collector' ? config.collector : config.executor;

  const tokenService = new KiwoomTokenService({
    profile,
    appKey: credentials?.appKey ?? '',
    appSecret: credentials?.appSecret ?? '',
    restUrl: config.restUrl,
    staticToken: config.accessToken,
  });

  // Profile-tuned rate budgets. Numbers are conservative placeholders —
  // Phase 6/8 will tune against vendor-documented limits.
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
    tokenService,
    rateLimiter,
  });

  const wsClient = new KiwoomWsClient({
    profile,
    wsUrl: config.wsUrl,
    tokenService,
  });

  return new KiwoomBrokerageGateway({
    profile,
    apiClient,
    wsClient,
    tokenService,
    // Phase 6.8 + 8: auto-reconnect for both profiles. Collector reuses
    // it on market-data outages; executor on execution-stream outages.
    // Backoff caps prevent reconnect storms.
    reconnect: { enabled: true },
  });
}

const collectorGatewayProvider: Provider = {
  provide: COLLECTOR_BROKERAGE_GATEWAY,
  inject: [KIWOOM_CONFIG],
  useFactory: (config: KiwoomConfig) => buildKiwoomGateway(config, 'collector'),
};

const executorGatewayProvider: Provider = {
  provide: EXECUTOR_BROKERAGE_GATEWAY,
  inject: [KIWOOM_CONFIG],
  useFactory: (config: KiwoomConfig) => buildKiwoomGateway(config, 'executor'),
};

@Global()
@Module({
  providers: [collectorGatewayProvider, executorGatewayProvider, BrokerageGatewayResolver],
  exports: [COLLECTOR_BROKERAGE_GATEWAY, EXECUTOR_BROKERAGE_GATEWAY, BrokerageGatewayResolver],
})
export class BrokerageModule {}
