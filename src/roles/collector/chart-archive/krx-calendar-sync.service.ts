import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { get as httpGet } from 'http';
import { get as httpsGet } from 'https';
import { DataSource } from 'typeorm';
import { CHART_ARCHIVE_CONFIG, type ChartArchiveConfig } from '@config/chart-archive.config';
import { ChartArchiveAlertService } from './chart-archive-alert.service';
import { KrxCalendarService } from './krx-calendar.service';

const SCHEDULER_NAME = 'collector.chart-archive.calendar-sync';

@Injectable()
export class KrxCalendarSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KrxCalendarSyncService.name);

  constructor(
    @Inject(CHART_ARCHIVE_CONFIG) private readonly config: ChartArchiveConfig,
    private readonly registry: SchedulerRegistry,
    private readonly calendar: KrxCalendarService,
    private readonly alerts: ChartArchiveAlertService,
    @Optional() @InjectDataSource() private readonly dataSource?: DataSource,
  ) {}

  onModuleInit(): void {
    if (!this.config.calendarSyncEnabled) return;
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    if (this.registry.doesExist('timeout', SCHEDULER_NAME)) {
      this.registry.deleteTimeout(SCHEDULER_NAME);
    }
  }

  async syncOnce(): Promise<{ affectedRows: number }> {
    if (!this.dataSource) throw new Error('DataSource is required for KRX calendar sync');
    const source = this.config.calendarSyncUrl || this.config.calendarSyncFile;
    if (!source) {
      this.logger.warn('KRX calendar sync skipped: CHART_ARCHIVE_CALENDAR_SYNC_URL/FILE is not configured');
      return { affectedRows: 0 };
    }

    const syncRunId = randomUUID();
    await this.dataSource.query(
      `INSERT INTO krx_calendar_sync_runs (id, started_at, source, status, revision)
       VALUES ($1, NOW(), $2, 'RUNNING', 1)`,
      [syncRunId, this.config.calendarSyncUrl ? 'krx_csv_url' : 'manual_csv'],
    );

    try {
      const text = this.config.calendarSyncUrl
        ? await fetchText(this.config.calendarSyncUrl)
        : await readFile(this.config.calendarSyncFile, 'utf8');
      const rows = parseCalendarCsv(text);
      let affectedRows = 0;
      for (const row of rows) {
        const isPartialDay = row.isTradingDay && row.sessionCloseKst !== null && row.sessionCloseKst !== '15:20';
        const result = (await this.dataSource.query(
          `
            INSERT INTO krx_calendar (
              trade_date, is_trading_day, session_open_kst, session_close_kst,
              is_partial_day, source, holiday_name, notes, revision,
              source_updated_at, last_synced_at, updated_by, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, NOW(), NOW(), 'calendar-sync', NOW(), NOW())
            ON CONFLICT (trade_date)
            DO UPDATE SET
              is_trading_day = EXCLUDED.is_trading_day,
              session_open_kst = EXCLUDED.session_open_kst,
              session_close_kst = EXCLUDED.session_close_kst,
              is_partial_day = EXCLUDED.is_partial_day,
              holiday_name = EXCLUDED.holiday_name,
              notes = EXCLUDED.notes,
              source_updated_at = NOW(),
              last_synced_at = NOW(),
              updated_at = NOW()
            WHERE krx_calendar.source != 'manual_override'
            RETURNING trade_date
          `,
          [
            row.tradeDate,
            row.isTradingDay,
            row.sessionOpenKst,
            row.sessionCloseKst,
            isPartialDay,
            this.config.calendarSyncUrl ? 'krx_api' : 'manual_csv',
            row.holidayName,
            row.notes,
          ],
        )) as Array<{ trade_date: string }>;
        affectedRows += result.length;
      }
      await this.dataSource.query(
        `UPDATE krx_calendar_sync_runs SET status='SUCCESS', finished_at=NOW(), affected_rows=$2 WHERE id=$1`,
        [syncRunId, affectedRows],
      );
      await this.calendar.refreshFromDb();
      await this.calendar.publishCalendarChanged({ reason: 'sync', syncRunId, affectedRows });
      this.logger.log(`KRX calendar sync completed affectedRows=${affectedRows}`);
      return { affectedRows };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.dataSource.query(
        `UPDATE krx_calendar_sync_runs SET status='FAILED', finished_at=NOW(), error_message=$2 WHERE id=$1`,
        [syncRunId, message],
      );
      await this.alerts.raise({
        category: 'krx-calendar-sync',
        severity: 'critical',
        subject: 'KRX calendar sync failed',
        message,
        metadata: { syncRunId },
      });
      throw err;
    }
  }

  private scheduleNext(): void {
    if (this.registry.doesExist('timeout', SCHEDULER_NAME)) {
      this.registry.deleteTimeout(SCHEDULER_NAME);
    }
    const next = nextKstRunAt(new Date(), this.config.calendarSyncTimeKst);
    const handle = setTimeout(() => {
      void this.syncOnce()
        .catch((err) => this.logger.warn(`KRX calendar sync failed: ${err instanceof Error ? err.message : err}`))
        .finally(() => this.scheduleNext());
    }, Math.max(1_000, next.getTime() - Date.now()));
    this.registry.addTimeout(SCHEDULER_NAME, handle);
    this.logger.log(`scheduler ${SCHEDULER_NAME} next=${next.toISOString()} (${this.config.calendarSyncTimeKst} KST)`);
  }
}

interface CalendarCsvRow {
  tradeDate: string;
  isTradingDay: boolean;
  sessionOpenKst: string | null;
  sessionCloseKst: string | null;
  holidayName: string | null;
  notes: string | null;
}

function parseCalendarCsv(text: string): CalendarCsvRow[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line).map((item) => item.trim());
    const obj = Object.fromEntries(headers.map((key, index) => [key, values[index] ?? '']));
    const isTradingDay = parseBool(obj.isTradingDay ?? obj.is_trading_day);
    return {
      tradeDate: String(obj.tradeDate ?? obj.trade_date),
      isTradingDay,
      sessionOpenKst: isTradingDay ? String(obj.sessionOpenKst || obj.session_open_kst || '09:00') : null,
      sessionCloseKst: isTradingDay ? String(obj.sessionCloseKst || obj.session_close_kst || '15:20') : null,
      holidayName: String(obj.holidayName || obj.holiday_name || '') || null,
      notes: String(obj.notes || '') || null,
    };
  }).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.tradeDate));
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];
    if (ch === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function parseBool(raw: unknown): boolean {
  const value = String(raw).trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'y' || value === 'yes';
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith('https:') ? httpsGet : httpGet;
    getter(url, (res) => {
      if ((res.statusCode ?? 500) >= 400) {
        reject(new Error(`calendar source returned HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

function nextKstRunAt(now: Date, hhmm: string): Date {
  const [hourRaw, minuteRaw] = hhmm.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const kstNow = new Date(now.getTime() + 9 * 60 * 60_000);
  const targetKstMs = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate(), hour, minute);
  const targetUtc = new Date(targetKstMs - 9 * 60 * 60_000);
  if (targetUtc.getTime() <= now.getTime()) targetUtc.setUTCDate(targetUtc.getUTCDate() + 1);
  return targetUtc;
}
