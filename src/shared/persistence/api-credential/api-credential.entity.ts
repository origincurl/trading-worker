import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  ApiCredentialStatus,
  MarketEnv,
} from '@shared/model/api-credential/market-env.enum';
import { ApiCredentialModel } from '@shared/model/api-credential/api-credential.model';

// Phase A scope: only the top-level ApiCredentialEntity. Capability and
// endpoint-state tables (api_credential_capabilities,
// api_credential_endpoint_states) are deliberately NOT mirrored here —
// see md/new-phase/03-worker-direct-config-tables.md task list.
@Entity('api_credentials')
@Index('uq_api_credentials_active_app_key', ['provider', 'marketEnv', 'appKeyHash'], {
  unique: true,
  where: "status != 'REVOKED' AND deleted_at IS NULL AND app_key_hash IS NOT NULL",
})
export class ApiCredentialEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'owner_user_id', type: 'bigint', nullable: true })
  ownerUserId!: number | null;

  @Column({ type: 'varchar', length: 100 })
  provider!: string;

  @Column({ name: 'market_env', type: 'enum', enum: MarketEnv })
  marketEnv!: MarketEnv;

  @Column({ name: 'app_key_enc', type: 'text', nullable: true })
  appKeyEnc!: string | null;

  @Column({ name: 'app_key_hash', type: 'varchar', length: 128, nullable: true })
  appKeyHash!: string | null;

  @Column({ name: 'app_secret_enc', type: 'text', nullable: true })
  appSecretEnc!: string | null;

  @Column({ name: 'key_expires_at', type: 'timestamp', nullable: true })
  keyExpiresAt!: Date | null;

  @CreateDateColumn({ name: 'registered_at', type: 'timestamp' })
  registeredAt!: Date;

  @Column({ name: 'last_rotated_at', type: 'timestamp', nullable: true })
  lastRotatedAt!: Date | null;

  @Column({ type: 'enum', enum: ApiCredentialStatus, default: ApiCredentialStatus.Unknown })
  status!: ApiCredentialStatus;

  @Column({ name: 'status_reason', type: 'text', nullable: true })
  statusReason!: string | null;

  @Column({ name: 'last_success_at', type: 'timestamp', nullable: true })
  lastSuccessAt!: Date | null;

  @Column({ name: 'last_failed_at', type: 'timestamp', nullable: true })
  lastFailedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  toModel(): ApiCredentialModel {
    return Object.assign(new ApiCredentialModel(), this);
  }
}
