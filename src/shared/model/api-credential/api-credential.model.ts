import { ApiCredentialStatus, MarketEnv } from './market-env.enum';

// Worker sees the raw encrypted material (appKeyEnc / appSecretEnc /
// accessTokenEnc / refreshTokenEnc). Decryption happens in a higher-layer
// service (out of scope for this phase) — repository never decrypts.
export class ApiCredentialModel {
  id!: number;
  ownerUserId!: number | null;
  provider!: string;
  marketEnv!: MarketEnv;
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
