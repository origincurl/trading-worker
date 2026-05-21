import type { Brokerage } from '@shared/model/account/brokerage.enum';
import type { MarketEnv } from '@shared/model/api-credential/market-env.enum';

// Decrypted credential material the worker holds in memory only.
// Never logged, never persisted, never published to bus payloads.
// `credentialId` is the row PK from collector_credentials or
// api_credentials (depending on origin) — used as the cache key for
// access-token-cache + credential-cooldown services.
export interface BrokerageCredentialMaterial {
  readonly kind: 'collector' | 'executor';
  readonly credentialId: number;
  readonly brokerage: Brokerage;
  readonly marketEnv: MarketEnv;
  readonly appKey: string;
  readonly appSecret: string;
}
