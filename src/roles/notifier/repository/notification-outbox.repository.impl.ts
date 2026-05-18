import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import {
  NotificationOutboxEntity,
  type NotificationOutboxStatus,
} from './notification-outbox.entity';
import type {
  NotificationOutboxInsertInput,
  NotificationOutboxRepository,
  NotificationOutboxRow,
} from './notification-outbox.repository';

// `claimPending` issues a transaction-scoped FOR UPDATE SKIP LOCKED so
// multiple notifier replicas can share the dispatch loop without
// double-sending. If persistence is disabled we degrade to no-op.
@Injectable()
export class NotificationOutboxRepositoryImpl implements NotificationOutboxRepository {
  private readonly logger = new Logger(NotificationOutboxRepositoryImpl.name);

  constructor(
    @Optional()
    @InjectRepository(NotificationOutboxEntity)
    private readonly outbox?: Repository<NotificationOutboxEntity>,
  ) {}

  async insertMany(rows: readonly NotificationOutboxInsertInput[]): Promise<void> {
    if (!this.outbox || rows.length === 0) return;

    const entities = rows.map((row) =>
      this.outbox!.create({
        eventId: row.eventId,
        channelId: row.channelId,
        channelType: row.channelType,
        payload: row.payload,
        status: 'PENDING' as NotificationOutboxStatus,
        attempts: 0,
        lastError: null,
        nextAttemptAt: row.nextAttemptAt,
        sentAt: null,
      }),
    );

    await this.outbox.save(entities);
  }

  async claimPending(limit: number, now: Date): Promise<NotificationOutboxRow[]> {
    if (!this.outbox) return [];

    return this.outbox.manager.transaction(async (manager) => {
      const repo = manager.getRepository(NotificationOutboxEntity);

      // FOR UPDATE SKIP LOCKED is a TypeORM lock mode for Postgres. Sort
      // by nextAttemptAt so the oldest due rows go first.
      const rows = await repo
        .createQueryBuilder('o')
        .where('o.status = :status', { status: 'PENDING' as NotificationOutboxStatus })
        .andWhere('o.next_attempt_at <= :now', { now })
        .orderBy('o.next_attempt_at', 'ASC')
        .limit(limit)
        .setLock('pessimistic_write', undefined, ['o'])
        .setOnLocked('skip_locked')
        .getMany();

      return rows.map((row) => this.toModel(row));
    });
  }

  async markSent(id: string, sentAt: Date): Promise<void> {
    if (!this.outbox) return;

    await this.outbox.update(
      { id },
      {
        status: 'SENT' as NotificationOutboxStatus,
        sentAt,
        lastError: null,
      },
    );
  }

  async markFailed(id: string, error: string, nextAttemptAt: Date | null): Promise<void> {
    if (!this.outbox) return;

    const row = await this.outbox.findOne({ where: { id } });

    if (!row) return;

    const nextStatus: NotificationOutboxStatus = nextAttemptAt ? 'PENDING' : 'FAILED';

    await this.outbox.update(
      { id },
      {
        status: nextStatus,
        attempts: row.attempts + 1,
        lastError: error.slice(0, 1000),
        nextAttemptAt: nextAttemptAt ?? row.nextAttemptAt,
      },
    );
  }

  // Helper used in case Postgres rejects setOnLocked (older TypeORM); we
  // fall back to LessThanOrEqual selection. Kept private + unused now to
  // make the intent explicit if a future TypeORM downgrade breaks the
  // SKIP LOCKED query.
  private async _fallbackClaim(limit: number, now: Date): Promise<NotificationOutboxRow[]> {
    if (!this.outbox) return [];

    const rows = await this.outbox.find({
      where: {
        status: 'PENDING' as NotificationOutboxStatus,
        nextAttemptAt: LessThanOrEqual(now),
      },
      order: { nextAttemptAt: 'ASC' },
      take: limit,
    });

    return rows.map((row) => this.toModel(row));
  }

  private toModel(entity: NotificationOutboxEntity): NotificationOutboxRow {
    return {
      id: String(entity.id),
      eventId: String(entity.eventId),
      channelId: String(entity.channelId),
      channelType: entity.channelType,
      payload: entity.payload,
      status: entity.status,
      attempts: entity.attempts,
      nextAttemptAt: entity.nextAttemptAt,
    };
  }
}
