import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AccountStatus } from '@shared/model/account/account-status.enum';
import { Brokerage } from '@shared/model/account/brokerage.enum';
import { AccountModel } from '@shared/model/account/account.model';

@Index('IDX_account_investor_id', ['investorId'])
@Index('uq_accounts_investor_external', ['investorId', 'brokerage', 'accountNumber', 'isPaper'], {
  unique: true,
  where: '"deleted_at" IS NULL AND "account_number" IS NOT NULL',
})
@Entity('accounts')
export class AccountEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'investor_id', type: 'bigint' })
  investorId!: number;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'account_number', type: 'varchar', length: 100, nullable: true })
  accountNumber!: string | null;

  @Column({ type: 'enum', enum: Brokerage, nullable: true })
  brokerage!: Brokerage | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  currency!: string | null;

  @Column({ type: 'enum', enum: AccountStatus })
  status!: AccountStatus;

  @Column({ name: 'is_paper', type: 'boolean' })
  isPaper!: boolean;

  @Column({ name: 'is_trade_enabled', type: 'boolean' })
  isTradeEnabled!: boolean;

  @Column({ name: 'kill_switch_enabled', type: 'boolean', default: false })
  killSwitchEnabled!: boolean;

  @Column({ name: 'kill_switch_reason', type: 'text', nullable: true })
  killSwitchReason!: string | null;

  @Column({ name: 'kill_switch_activated_at', type: 'timestamptz', nullable: true })
  killSwitchActivatedAt!: Date | null;

  @Column({ name: 'kill_switch_activated_by', type: 'bigint', nullable: true })
  killSwitchActivatedBy!: number | null;

  @Column({ name: 'kill_switch_deactivated_at', type: 'timestamptz', nullable: true })
  killSwitchDeactivatedAt!: Date | null;

  @Column({ name: 'kill_switch_deactivated_by', type: 'bigint', nullable: true })
  killSwitchDeactivatedBy!: number | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  toModel(): AccountModel {
    return Object.assign(new AccountModel(), this);
  }
}
