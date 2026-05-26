import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '@shared/persistence/base.entity';
import type {
  AccountBalanceBrokerage,
  AccountBalanceMarketEnv,
} from './account-balance.model';
import type { TrackerPositionModel } from './position.model';

// Per-symbol position keyed by accountExternalId — workers never know
// BE-internal account.id. Quantity precision (24,8) keeps fractional
// futures / FX support open without schema churn.
@Entity({ name: 'account_positions' })
@Unique('uq_account_positions_acct_symbol', [
  'accountExternalId',
  'brokerage',
  'marketEnv',
  'symbol',
])
@Index('ix_account_positions_synced_at', ['syncedAt'])
export class PositionEntity extends BaseEntity {
  @Column({ name: 'account_external_id', type: 'varchar', length: 255 })
  accountExternalId!: string;

  @Column({ type: 'varchar', length: 32 })
  brokerage!: AccountBalanceBrokerage;

  @Column({ name: 'market_env', type: 'varchar', length: 16 })
  marketEnv!: AccountBalanceMarketEnv;

  @Column({ type: 'varchar', length: 32 })
  symbol!: string;

  @Column({ type: 'numeric', precision: 24, scale: 8 })
  quantity!: number;

  @Column({ name: 'locked_quantity', type: 'numeric', precision: 24, scale: 8, nullable: true })
  lockedQuantity!: number | null;

  @Column({ name: 'average_price', type: 'numeric', precision: 20, scale: 6 })
  averagePrice!: number;

  @Column({ name: 'current_price', type: 'numeric', precision: 20, scale: 6, nullable: true })
  currentPrice!: number | null;

  @Column({ name: 'market_value', type: 'numeric', precision: 24, scale: 6, nullable: true })
  marketValue!: number | null;

  @Column({ name: 'unrealized_pnl', type: 'numeric', precision: 24, scale: 6, nullable: true })
  unrealizedPnl!: number | null;

  @Column({ name: 'synced_at', type: 'timestamptz', nullable: true })
  syncedAt!: Date | null;

  toModel(): TrackerPositionModel {
    return {
      accountExternalId: this.accountExternalId,
      brokerage: this.brokerage,
      marketEnv: this.marketEnv,
      symbol: this.symbol,
      quantity: Number(this.quantity),
      lockedQuantity: this.lockedQuantity !== null ? Number(this.lockedQuantity) : null,
      averagePrice: Number(this.averagePrice),
      currentPrice: this.currentPrice !== null ? Number(this.currentPrice) : null,
      marketValue: this.marketValue !== null ? Number(this.marketValue) : null,
      unrealizedPnl: this.unrealizedPnl !== null ? Number(this.unrealizedPnl) : null,
      syncedAt: this.syncedAt ? this.syncedAt.toISOString() : null,
    };
  }
}
