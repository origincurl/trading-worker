import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AccountTraderGrantPermission } from '@shared/model/account/account-trader-grant-permission.enum';
import { AccountTraderGrantModel } from '@shared/model/account/account-trader-grant.model';

@Entity('account_trader_grants')
@Index('IDX_account_trader_grant_investor_id', ['investorId'])
@Index('IDX_account_trader_grant_account_id', ['accountId'])
@Index('IDX_account_trader_grant_trader_id', ['traderId'])
@Index('IDX_account_trader_grant_granted_by_user_id', ['grantedByUserId'])
@Index('UQ_account_trader_grant_active_pair', ['accountId', 'traderId'], { unique: true })
export class AccountTraderGrantEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'investor_id', type: 'bigint' })
  investorId!: number;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId!: number;

  @Column({ name: 'trader_id', type: 'bigint' })
  traderId!: number;

  @Column({ name: 'granted_by_user_id', type: 'bigint' })
  grantedByUserId!: number;

  @Column({ type: 'jsonb' })
  permissions!: AccountTraderGrantPermission[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  toModel(): AccountTraderGrantModel {
    return Object.assign(new AccountTraderGrantModel(), this);
  }
}
