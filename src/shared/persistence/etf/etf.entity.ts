import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EtfModel } from '@shared/model/etf/etf.model';

@Index('IDX_etf_market_id_symbol', ['marketId', 'symbol'])
@Index('UQ_etf_market_id_symbol_active', ['marketId', 'symbol'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Entity('etfs')
export class EtfEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'market_id', type: 'bigint' })
  marketId!: number;

  @Column({ type: 'varchar', length: 50 })
  symbol!: string;

  @Column({ name: 'isin_symbol', type: 'varchar', length: 20, nullable: true })
  isinSymbol!: string | null;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'english_name', type: 'varchar', length: 255, nullable: true })
  englishName!: string | null;

  @Column({ name: 'tracking_index', type: 'varchar', length: 100, nullable: true })
  trackingIndex!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  issuer!: string | null;

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

  toModel(): EtfModel {
    return Object.assign(new EtfModel(), this);
  }
}
