import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MarketStatus } from '@shared/model/market/market-status.enum';
import { MarketModel } from '@shared/model/market/market.model';

@Index('IDX_market_code', ['code'])
@Entity('markets')
export class MarketEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'exchange_id', type: 'bigint' })
  exchangeId!: number;

  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  country!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  currency!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  timezone!: string | null;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive!: boolean;

  @Column({ name: 'is_tradable', type: 'boolean' })
  isTradable!: boolean;

  @Column({ name: 'is_orderable', type: 'boolean' })
  isOrderable!: boolean;

  @Column({ name: 'open_time', type: 'time', nullable: true })
  openTime!: string | null;

  @Column({ name: 'close_time', type: 'time', nullable: true })
  closeTime!: string | null;

  @Column({ type: 'enum', enum: MarketStatus })
  status!: MarketStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  toModel(): MarketModel {
    return Object.assign(new MarketModel(), this);
  }
}
