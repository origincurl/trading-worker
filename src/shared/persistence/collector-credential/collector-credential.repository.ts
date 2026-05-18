import type { Brokerage } from '@shared/model/account/brokerage.enum';
import type { MarketEnv } from '@shared/model/api-credential/market-env.enum';
import type { CollectorCredentialModel } from '@shared/model/collector-credential/collector-credential.model';

export interface CollectorCredentialRepository {
  // Active = status='ACTIVE' AND deleted_at IS NULL. Worker calls this
  // from its vendor-bootstrap path (collector role only).
  findActive(brokerage: Brokerage, marketEnv: MarketEnv): Promise<CollectorCredentialModel[]>;
  // Lifecycle updates from the collector vendor-health probe. Resets the
  // failure counter on success, increments + records reason on failure.
  markSuccess(id: number): Promise<void>;
  markFailure(id: number, reason: string): Promise<void>;
}
