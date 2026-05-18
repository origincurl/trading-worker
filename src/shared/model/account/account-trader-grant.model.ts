import { AccountTraderGrantPermission } from './account-trader-grant-permission.enum';

export class AccountTraderGrantModel {
  id!: number;
  investorId!: number;
  accountId!: number;
  traderId!: number;
  grantedByUserId!: number;
  permissions!: AccountTraderGrantPermission[];
  isActive!: boolean;
  revokedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}
