import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StrategyType } from '@shared/model/strategy/strategy-type.enum';
import { AccountStrategyModel } from '@shared/model/account-strategy/account-strategy.model';

@Index('IDX_account_strategy_account_id', ['accountId'])
@Index('IDX_account_strategy_source_strategy_id', ['sourceStrategyId'])
@Index('IDX_account_strategy_notification_template_id', ['notificationTemplateId'])
@Entity('account_strategies')
export class AccountStrategyEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId!: number;

  @Column({ name: 'source_strategy_id', type: 'bigint', nullable: true })
  sourceStrategyId!: number | null;

  @Column({ name: 'source_version', type: 'int', nullable: true })
  sourceVersion!: number | null;

  @Column({ name: 'notification_template_id', type: 'bigint', nullable: true })
  notificationTemplateId!: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  name!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'strategy_type', type: 'enum', enum: StrategyType })
  strategyType!: StrategyType;

  @Column({ name: 'rule_json', type: 'json' })
  ruleJson!: Record<string, unknown>;

  @Column({ type: 'int' })
  priority!: number;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive!: boolean;

  @Column({ name: 'is_auto_order_enabled', type: 'boolean' })
  isAutoOrderEnabled!: boolean;

  @Column({ name: 'is_notification_enabled', type: 'boolean', default: true })
  isNotificationEnabled!: boolean;

  @Column({
    name: 'investment_ratio',
    type: 'decimal',
    precision: 12,
    scale: 6,
    nullable: true,
  })
  investmentRatio!: string | null;

  @Column({ name: 'config_json', type: 'json', nullable: true })
  configJson!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  toModel(): AccountStrategyModel {
    return Object.assign(new AccountStrategyModel(), this);
  }
}
