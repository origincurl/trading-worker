import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AlertRaisedPayload } from '@shared/event/alert-raised.event';
import { AlertRaisedEntity } from './alert-raised.entity';

export const ALERT_REPOSITORY = Symbol('ALERT_REPOSITORY');

export interface AlertRepository {
  insert(payload: AlertRaisedPayload): Promise<'inserted' | 'duplicate'>;
  countDeadLettersSince(sinceMs: number): Promise<number>;
  countFailedOrdersSince(sinceMs: number): Promise<number>;
}

@Injectable()
export class AlertRepositoryImpl implements AlertRepository {
  private readonly logger = new Logger(AlertRepositoryImpl.name);

  constructor(
    @Optional()
    @InjectRepository(AlertRaisedEntity)
    private readonly alerts?: Repository<AlertRaisedEntity>,
  ) {}

  async insert(payload: AlertRaisedPayload): Promise<'inserted' | 'duplicate'> {
    if (!this.alerts) {
      this.logger.debug(`persistence disabled — alert insert skipped: ${payload.alertId}`);

      return 'inserted';
    }

    const existing = await this.alerts.findOne({ where: { alertId: payload.alertId } });

    if (existing) return 'duplicate';

    await this.alerts.save(
      this.alerts.create({
        alertId: payload.alertId,
        category: payload.category,
        severity: payload.severity,
        subject: payload.subject,
        message: payload.message,
        metadata: payload.metadata ?? null,
        raisedAt: new Date(payload.raisedAt),
        workerInstanceId: payload.workerInstanceId,
      }),
    );

    return 'inserted';
  }

  // Phase 9 dead-letter spike rule reads from collector_dead_letter.
  // Use a raw query so the detector module doesn't import collector
  // entities — that would break role-isolation (eslint also blocks
  // the import at the file level).
  async countDeadLettersSince(sinceMs: number): Promise<number> {
    return this.countSince('collector_dead_letter', 'created_at', sinceMs);
  }

  async countFailedOrdersSince(sinceMs: number): Promise<number> {
    return this.countSince('order_attempt', 'updated_at', sinceMs, "status = 'failed'");
  }

  private async countSince(
    table: string,
    timestampColumn: string,
    sinceMs: number,
    extraWhere?: string,
  ): Promise<number> {
    if (!this.alerts) return 0;

    const since = new Date(sinceMs);
    const where = extraWhere
      ? `${extraWhere} AND ${timestampColumn} >= $1`
      : `${timestampColumn} >= $1`;
    const sql = `SELECT COUNT(*)::int AS c FROM ${table} WHERE ${where}`;

    try {
      const rows = (await this.alerts.manager.query(sql, [since])) as Array<{ c: number }>;

      return rows[0]?.c ?? 0;
    } catch (err) {
      this.logger.debug(
        `count from ${table} failed (probably no schema): ${err instanceof Error ? err.message : err}`,
      );

      return 0;
    }
  }
}
