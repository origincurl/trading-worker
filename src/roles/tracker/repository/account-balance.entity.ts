import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '@shared/persistence/base.entity';
import type {
  AccountBalanceCashDetails,
  AccountBalanceModel,
  AccountBalanceBrokerage,
  AccountBalanceMarketEnv,
} from './account-balance.model';

// `account_balances` row. Worker stores balance per (accountExternalId,
// brokerage, marketEnv) tuple — the worker never learns the BE-internal
// account.id, so external id is the keying authority here. Numeric columns
// use 24,6 to comfortably hold KRW totals while leaving headroom for FX
// brokerages later.
@Entity({ name: 'account_balances' })
@Unique('uq_account_balances_acct', ['accountExternalId', 'brokerage', 'marketEnv'])
@Index('ix_account_balances_synced_at', ['syncedAt'])
export class AccountBalanceEntity extends BaseEntity {
  @Column({ name: 'account_external_id', type: 'varchar', length: 255 })
  accountExternalId!: string;

  @Column({ type: 'varchar', length: 32 })
  brokerage!: AccountBalanceBrokerage;

  @Column({ name: 'market_env', type: 'varchar', length: 16 })
  marketEnv!: AccountBalanceMarketEnv;

  @Column({ type: 'varchar', length: 20, nullable: true })
  currency!: string | null;

  @Column({ name: 'cash_balance', type: 'numeric', precision: 24, scale: 6 })
  cashBalance!: number;

  @Column({ name: 'available_cash', type: 'numeric', precision: 24, scale: 6, nullable: true })
  availableCash!: number | null;

  @Column({ name: 'total_asset', type: 'numeric', precision: 24, scale: 6, nullable: true })
  totalAsset!: number | null;

  @Column({ name: 'cash_details', type: 'jsonb', nullable: true })
  cashDetails!: AccountBalanceCashDetails | null;

  @Column({ name: 'synced_at', type: 'timestamptz', nullable: true })
  syncedAt!: Date | null;

  toModel(): AccountBalanceModel {
    return {
      accountExternalId: this.accountExternalId,
      brokerage: this.brokerage,
      marketEnv: this.marketEnv,
      currency: this.currency,
      cashBalance: Number(this.cashBalance),
      availableCash: this.availableCash !== null ? Number(this.availableCash) : null,
      totalAsset: this.totalAsset !== null ? Number(this.totalAsset) : null,
      cashDetails: this.cashDetails ?? null,
      syncedAt: this.syncedAt ? this.syncedAt.toISOString() : null,
    };
  }
}
