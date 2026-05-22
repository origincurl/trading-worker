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
    enumName: 'collector_credential_runtime_status',
    default: CollectorCredentialRuntimeStatus.Active,
  })
  /** @deprecated Use restStatus / wsStatus. Kept only for transition compatibility. */
  status!: CollectorCredentialRuntimeStatus;

  @Column({ name: 'cooldown_until', type: 'timestamp', nullable: true })
  /** @deprecated Use restCooldownUntil / wsCooldownUntil. Kept only for transition compatibility. */
  cooldownUntil!: Date | null;

  @Column({ name: 'last_rate_limited_at', type: 'timestamp', nullable: true })
  /** @deprecated Use restLastRateLimitedAt. Kept only for transition compatibility. */
  lastRateLimitedAt!: Date | null;

  @Column({ name: 'last_retry_after_ms', type: 'int', nullable: true })
  lastRetryAfterMs!: number | null;

  @Column({ name: 'last_auth_failed_at', type: 'timestamp', nullable: true })
  /** @deprecated Use restLastAuthFailedAt / wsLastAuthFailedAt. Kept only for transition compatibility. */
  lastAuthFailedAt!: Date | null;

  @Column({ name: 'last_ws_limited_at', type: 'timestamp', nullable: true })
  /** @deprecated Use wsLastLimitedAt. Kept only for transition compatibility. */
  lastWsLimitedAt!: Date | null;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  /** @deprecated Use restLastErrorMessage / wsLastErrorMessage. Kept only for transition compatibility. */
  lastErrorMessage!: string | null;

  @Column({
    name: 'rest_status',
    type: 'enum',
    enum: CollectorCredentialRuntimeStatus,
    enumName: 'collector_credential_runtime_status',
    default: CollectorCredentialRuntimeStatus.Active,
  })
  restStatus!: CollectorCredentialRuntimeStatus;

  @Column({ name: 'rest_cooldown_until', type: 'timestamp', nullable: true })
  restCooldownUntil!: Date | null;

  @Column({ name: 'rest_last_rate_limited_at', type: 'timestamp', nullable: true })
  restLastRateLimitedAt!: Date | null;

  @Column({ name: 'rest_last_retry_after_ms', type: 'int', nullable: true })
  restLastRetryAfterMs!: number | null;

  @Column({ name: 'rest_last_auth_failed_at', type: 'timestamp', nullable: true })
  restLastAuthFailedAt!: Date | null;

  @Column({ name: 'rest_last_error_message', type: 'text', nullable: true })
  restLastErrorMessage!: string | null;

  @Column({
    name: 'ws_status',
    type: 'enum',
    enum: CollectorCredentialRuntimeStatus,
    enumName: 'collector_credential_runtime_status',
    default: CollectorCredentialRuntimeStatus.Active,
  })
  wsStatus!: CollectorCredentialRuntimeStatus;

  @Column({ name: 'ws_cooldown_until', type: 'timestamp', nullable: true })
  wsCooldownUntil!: Date | null;

  @Column({ name: 'ws_last_limited_at', type: 'timestamp', nullable: true })
  wsLastLimitedAt!: Date | null;

  @Column({ name: 'ws_last_auth_failed_at', type: 'timestamp', nullable: true })
  wsLastAuthFailedAt!: Date | null;

  @Column({ name: 'ws_last_error_message', type: 'text', nullable: true })
  wsLastErrorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
