import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StockModel } from '@shared/model/stock/stock.model';

// Mirrors trading-be StockEntity column-for-column. Worker is a read-only
// consumer of `stocks` (admin observation flag + symbol/market lookups).
// Drift between BE and worker must be caught in review — see
// md/new-phase/03-worker-direct-config-tables.md §7.
@Index('IDX_stock_market_id_symbol', ['marketId', 'symbol'])
@Index('UQ_stock_market_id_symbol_active', ['marketId', 'symbol'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Entity('stocks')
export class StockEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'market_id', type: 'bigint' })
  marketId!: number;

  @Column({ type: 'varchar', length: 50 })
  symbol!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'english_name', type: 'varchar', length: 255, nullable: true })
  englishName!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  sector!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  industry!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  currency!: string | null;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive!: boolean;

  @Column({ name: 'is_tradable', type: 'boolean' })
  isTradable!: boolean;

  @Column({ name: 'is_observed', type: 'boolean', default: false })
  isObserved!: boolean;

  @Column({ type: 'json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'listed_at', type: 'timestamp', nullable: true })
  listedAt!: Date | null;

  @Column({ name: 'delisted_at', type: 'timestamp', nullable: true })
  delistedAt!: Date | null;

  @Column({ name: 'last_synced_at', type: 'timestamp', nullable: true })
  lastSyncedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  toModel(): StockModel {
    return Object.assign(new StockModel(), this);
  }
}
