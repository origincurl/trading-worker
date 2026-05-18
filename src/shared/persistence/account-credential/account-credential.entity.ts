import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Brokerage } from '@shared/model/account/brokerage.enum';
import { MarketEnv } from '@shared/model/api-credential/market-env.enum';
import { AccountCredentialModel } from '@shared/model/account/account-credential.model';

// Phase 5 cleanup mirrored from BE: legacy plaintext columns removed; all
// secret material is on api_credentials referenced by apiCredentialId.
@Index('IDX_account_credential_account_id', ['accountId'])
@Index('ix_account_credentials_api_credential_id', ['apiCredentialId'])
@Entity('account_credentials')
export class AccountCredentialEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId!: number;

  @Column({ type: 'enum', enum: Brokerage, nullable: true })
  brokerage!: Brokerage | null;

  @Column({ name: 'api_credential_id', type: 'bigint', nullable: true })
  apiCredentialId!: number | null;

  @Column({ name: 'market_env', type: 'enum', enum: MarketEnv, nullable: true })
  marketEnv!: MarketEnv | null;

  @Column({ name: 'permission_scope', type: 'jsonb', nullable: true })
  permissionScope!: string[] | null;

  @Column({ name: 'account_external_id', type: 'varchar', length: 255, nullable: true })
  accountExternalId!: string | null;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive!: boolean;

  @Column({ name: 'last_tested_at', type: 'timestamp', nullable: true })
  lastTestedAt!: Date | null;

  @Column({ name: 'last_success_at', type: 'timestamp', nullable: true })
  lastSuccessAt!: Date | null;

  @Column({ name: 'last_failed_at', type: 'timestamp', nullable: true })
  lastFailedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  toModel(): AccountCredentialModel {
    return Object.assign(new AccountCredentialModel(), this);
  }
}
