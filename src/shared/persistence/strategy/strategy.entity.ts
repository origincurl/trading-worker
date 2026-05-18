import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StrategyType } from '@shared/model/strategy/strategy-type.enum';
import { StrategyModel } from '@shared/model/strategy/strategy.model';

@Entity('strategies')
export class StrategyEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'strategy_type', type: 'enum', enum: StrategyType })
  strategyType!: StrategyType;

  @Column({ name: 'rule_json', type: 'json' })
  ruleJson!: Record<string, unknown>;

  @Column({ name: 'config_json', type: 'json', nullable: true })
  configJson!: Record<string, unknown> | null;

  @Column({ name: 'event_types', type: 'json', default: () => "('[]')" })
  eventTypes!: string[];

  @Column({ type: 'int', default: 1 })
  version!: number;

  // Mirrors BE: createdByUserId / updatedByUserId are declared on the
  // entity without @Column, so they are NOT persisted columns — kept here
  // for column-shape parity. Worker should never write them.
  createdByUserId!: number | null;

  updatedByUserId!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  toModel(): StrategyModel {
    return Object.assign(new StrategyModel(), this);
  }
}
