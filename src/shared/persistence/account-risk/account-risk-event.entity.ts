import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AccountRiskEventModel } from '@shared/model/account-risk/account-risk-event.model';

@Index('IDX_account_risk_event_account_risk_id', ['accountRiskId'])
@Index('UQ_account_risk_event_risk_type', ['accountRiskId', 'eventType'], { unique: true })
@Entity('account_risk_events')
export class AccountRiskEventEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'account_risk_id', type: 'bigint' })
  accountRiskId!: number;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  toModel(): AccountRiskEventModel {
    return Object.assign(new AccountRiskEventModel(), this);
  }
}
