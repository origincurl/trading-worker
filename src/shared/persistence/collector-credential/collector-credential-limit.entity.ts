import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum CollectorCredentialRuntimeStatus {
  Active = 'ACTIVE',
  RateLimited = 'RATE_LIMITED',
  Cooldown = 'COOLDOWN',
  AuthFailed = 'AUTH_FAILED',
  WsLimited = 'WS_LIMITED',
}

@Entity('collector_credential_limit_policies')
@Unique('uq_collector_credential_limit_policy_credential', ['collectorCredentialId'])
export class CollectorCredentialLimitPolicyEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'collector_credential_id', type: 'bigint' })
  collectorCredentialId!: number;

  @Column({
    name: 'rest_requests_per_second',
    type: 'numeric',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  restRequestsPerSecond!: string | null;

  @Column({
    name: 'rest_requests_per_minute',
    type: 'numeric',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  restRequestsPerMinute!: string | null;

  @Column({ name: 'ws_max_connections', type: 'int', nullable: true })
  wsMaxConnections!: number | null;

  @Column({ name: 'ws_max_symbols', type: 'int', nullable: true })
  wsMaxSymbols!: number | null;

  @Column({ name: 'cooldown_default_ms', type: 'int', default: 60_000 })
  cooldownDefaultMs!: number;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}

@Entity('collector_credential_runtime_states')
@Unique('uq_collector_credential_runtime_state_credential', ['collectorCredentialId'])
export class CollectorCredentialRuntimeStateEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'collector_credential_id', type: 'bigint' })
  collectorCredentialId!: number;

  @Column({
    type: 'enum',
    enum: CollectorCredentialRuntimeStatus,
    default: CollectorCredentialRuntimeStatus.Active,
  })
  status!: CollectorCredentialRuntimeStatus;

  @Column({ name: 'cooldown_until', type: 'timestamp', nullable: true })
  cooldownUntil!: Date | null;

  @Column({ name: 'last_rate_limited_at', type: 'timestamp', nullable: true })
  lastRateLimitedAt!: Date | null;

  @Column({ name: 'last_retry_after_ms', type: 'int', nullable: true })
  lastRetryAfterMs!: number | null;

  @Column({ name: 'last_auth_failed_at', type: 'timestamp', nullable: true })
  lastAuthFailedAt!: Date | null;

  @Column({ name: 'last_ws_limited_at', type: 'timestamp', nullable: true })
  lastWsLimitedAt!: Date | null;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
