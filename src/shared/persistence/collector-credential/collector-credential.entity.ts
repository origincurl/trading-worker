import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Brokerage } from '@shared/model/account/brokerage.enum';
import {
  ApiCredentialStatus,
  MarketEnv,
} from '@shared/model/api-credential/market-env.enum';
import { CollectorCredentialModel } from '@shared/model/collector-credential/collector-credential.model';

@Entity('collector_credentials')
@Index('uq_collector_credentials_active_app_key', ['brokerage', 'marketEnv', 'appKeyHash'], {
  unique: true,
  where: "status != 'REVOKED' AND deleted_at IS NULL AND app_key_hash IS NOT NULL",
})
export class CollectorCredentialEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'enum', enum: Brokerage })
  brokerage!: Brokerage;

  @Column({ name: 'market_env', type: 'enum', enum: MarketEnv })
  marketEnv!: MarketEnv;

  @Column({ type: 'varchar', length: 100 })
  label!: string;

  @Column({ name: 'app_key_enc', type: 'text', nullable: true })
  appKeyEnc!: string | null;

  @Column({ name: 'app_key_hash', type: 'varchar', length: 128, nullable: true })
  appKeyHash!: string | null;

  @Column({ name: 'app_secret_enc', type: 'text', nullable: true })
  appSecretEnc!: string | null;

  @Column({ name: 'access_token_enc', type: 'text', nullable: true })
  accessTokenEnc!: string | null;

  @Column({ name: 'refresh_token_enc', type: 'text', nullable: true })
  refreshTokenEnc!: string | null;

  @Column({ name: 'token_expires_at', type: 'timestamp', nullable: true })
  tokenExpiresAt!: Date | null;

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

  @Column({ name: 'status_changed_at', type: 'timestamp', nullable: true })
  statusChangedAt!: Date | null;

  @Column({ name: 'last_health_check_at', type: 'timestamp', nullable: true })
  lastHealthCheckAt!: Date | null;

  @Column({ name: 'last_success_at', type: 'timestamp', nullable: true })
  lastSuccessAt!: Date | null;

  @Column({ name: 'last_failed_at', type: 'timestamp', nullable: true })
  lastFailedAt!: Date | null;

  @Column({ name: 'consecutive_failures', type: 'int', default: 0 })
  consecutiveFailures!: number;

  @Column({ name: 'last_error_code', type: 'varchar', length: 100, nullable: true })
  lastErrorCode!: string | null;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  toModel(): CollectorCredentialModel {
    return Object.assign(new CollectorCredentialModel(), this);
  }
}
