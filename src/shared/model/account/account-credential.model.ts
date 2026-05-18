import { MarketEnv } from '@shared/model/api-credential/market-env.enum';
import { Brokerage } from './brokerage.enum';

export class AccountCredentialModel {
  id!: number;
  accountId!: number;
  brokerage!: Brokerage | null;
  apiCredentialId!: number | null;
  marketEnv!: MarketEnv | null;
  permissionScope!: string[] | null;
  accountExternalId!: string | null;
  isActive!: boolean;
  lastTestedAt!: Date | null;
  lastSuccessAt!: Date | null;
  lastFailedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}
