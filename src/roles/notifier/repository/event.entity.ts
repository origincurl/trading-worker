import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

// Mirrors BE EventEntity columns (phase/07 spec §3) so a fresh worker DB
// can store events without an FK to internal account/strategy/risk PKs —
// those come later via BE control-plane resolution. UNIQUE on
// (source_type, source_id, event_type) gives idempotency on stream replay.
@Entity({ name: 'events' })
@Unique('uq_events_source_event', ['sourceType', 'sourceId', 'eventType'])
@Index('ix_events_occurred_at', ['occurredAt'])
@Index('ix_events_processed_at', ['processedAt'])
export class EventEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'source_type', type: 'varchar', length: 64 })
  sourceType!: string;

  @Column({ name: 'source_id', type: 'bigint', nullable: true })
  sourceId!: string | null;

  @Column({ name: 'account_id', type: 'bigint', nullable: true })
  accountId!: string | null;

  @Column({ name: 'account_strategy_event_id', type: 'bigint', nullable: true })
  accountStrategyEventId!: string | null;

  @Column({ name: 'account_risk_event_id', type: 'bigint', nullable: true })
  accountRiskEventId!: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ type: 'varchar', length: 20 })
  level!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
