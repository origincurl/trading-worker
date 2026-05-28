import type { Brokerage } from '@shared/model/account/brokerage.enum';
import type { MarketEnv } from '@shared/model/api-credential/market-env.enum';

// Decrypted credential material the worker holds in memory only.
// Never logged, never persisted, never published to bus payloads.
// `credentialId` is the row PK from collector_credentials or
// api_credentials (depending on origin). The numeric id is only unique
// within its table, so runtime caches must key by (kind, credentialId).
export interface BrokerageCredentialMaterial {
  readonly kind: 'collector' | 'executor';
  readonly credentialId: number;
  readonly brokerage: Brokerage;
  readonly marketEnv: MarketEnv;
  readonly accountExternalId?: string | null;
  readonly appKey: string;
  readonly appSecret: string;
  readonly wsMaxSymbols?: number | null;
}
