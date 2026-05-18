import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DecisionStatus } from '@shared/model/decision/decision-status.enum';
import { DecisionType } from '@shared/model/decision/decision-type.enum';
import { DecisionModel } from '@shared/model/decision/decision.model';

@Index('IDX_decision_account_id', ['accountId'])
@Index('IDX_decision_account_strategy_id', ['accountStrategyId'])
@Index('IDX_decision_strategy_id', ['strategyId'])
@Index('IDX_decision_stock_id', ['stockId'])
@Index('IDX_decision_decided_at', ['decidedAt'])
@Entity('decisions')
export class DecisionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId!: number;

  @Column({ name: 'account_strategy_id', type: 'bigint' })
  accountStrategyId!: number;

  @Column({ name: 'strategy_id', type: 'bigint' })
  strategyId!: number;

  @Column({ name: 'stock_id', type: 'bigint', nullable: true })
  stockId!: number | null;

  @Column({ name: 'decision_type', type: 'enum', enum: DecisionType })
  decisionType!: DecisionType;

  @Column({ type: 'enum', enum: DecisionStatus })
  status!: DecisionStatus;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 6, nullable: true })
  score!: string | null;

  @Column({ type: 'decimal', precision: 24, scale: 8, nullable: true })
  quantity!: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 6, nullable: true })
  price!: string | null;

  @Column({ type: 'decimal', precision: 24, scale: 6, nullable: true })
  amount!: string | null;

  @Column({ name: 'indicator_snapshot', type: 'json', nullable: true })
  indicatorSnapshot!: Record<string, unknown> | null;

  @Column({ name: 'decision_data', type: 'json', nullable: true })
  decisionData!: Record<string, unknown> | null;

  @Column({ name: 'decided_at', type: 'timestamp' })
  decidedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  toModel(): DecisionModel {
    return Object.assign(new DecisionModel(), this);
  }
}
