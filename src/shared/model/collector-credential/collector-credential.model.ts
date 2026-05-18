import { Brokerage } from '@shared/model/account/brokerage.enum';
import { ApiCredentialStatus, MarketEnv } from '@shared/model/api-credential/market-env.enum';

export class CollectorCredentialModel {
  id!: number;
  brokerage!: Brokerage;
  marketEnv!: MarketEnv;
  label!: string;
  appKeyEnc!: string | null;
  appKeyHash!: string | null;
  appSecretEnc!: string | null;
  accessTokenEnc!: string | null;
  refreshTokenEnc!: string | null;
  tokenExpiresAt!: Date | null;
  keyExpiresAt!: Date | null;
  registeredAt!: Date;
  lastRotatedAt!: Date | null;
  status!: ApiCredentialStatus;
  statusReason!: string | null;
  statusChangedAt!: Date | null;
  lastHealthCheckAt!: Date | null;
  lastSuccessAt!: Date | null;
  lastFailedAt!: Date | null;
  consecutiveFailures!: number;
  lastErrorCode!: string | null;
  lastErrorMessage!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
}
