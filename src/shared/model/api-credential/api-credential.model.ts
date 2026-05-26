import { ApiCredentialStatus, MarketEnv } from './market-env.enum';

// Worker sees the raw encrypted app key material. Decryption happens in a
// higher-layer service; repository code never decrypts.
export class ApiCredentialModel {
  id!: number;
  ownerUserId!: number | null;
  provider!: string;
  marketEnv!: MarketEnv;
  appKeyEnc!: string | null;
  appKeyHash!: string | null;
  appSecretEnc!: string | null;
  keyExpiresAt!: Date | null;
  registeredAt!: Date;
  lastRotatedAt!: Date | null;
  status!: ApiCredentialStatus;
  statusReason!: string | null;
  lastSuccessAt!: Date | null;
  lastFailedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
}
