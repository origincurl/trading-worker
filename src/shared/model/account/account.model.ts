import { AccountStatus } from './account-status.enum';
import { Brokerage } from './brokerage.enum';

export class AccountModel {
  id!: number;
  investorId!: number;
  name!: string;
  accountNumber!: string | null;
  brokerage!: Brokerage | null;
  currency!: string | null;
  status!: AccountStatus;
  isPaper!: boolean;
  isTradeEnabled!: boolean;
  description!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
}
