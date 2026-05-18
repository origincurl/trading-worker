import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AccountStrategyEventModel } from '@shared/model/account-strategy/account-strategy-event.model';

@Index('IDX_account_strategy_event_account_strategy_id', ['accountStrategyId'])
@Index('UQ_account_strategy_event_strategy_type', ['accountStrategyId', 'eventType'], {
  unique: true,
})
@Entity('account_strategy_events')
export class AccountStrategyEventEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'account_strategy_id', type: 'bigint' })
  accountStrategyId!: number;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  toModel(): AccountStrategyEventModel {
    return Object.assign(new AccountStrategyEventModel(), this);
  }
}
