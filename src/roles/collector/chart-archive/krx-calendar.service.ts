import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { REDIS_CLIENT, REDIS_SUBSCRIBER, type RedisClientToken } from '@shared/cache/redis.module';
import { DataSource } from 'typeorm';

const KNOWN_KRX_HOLIDAYS = new Set<string>([
  '2026-01-01',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-03-02',
  '2026-05-01',
  '2026-05-05',
  '2026-05-25',
  '2026-06-03',
  '2026-07-17',
  '2026-09-24',
  '2026-09-25',
  '2026-10-09',
  '2026-12-25',
  '2026-12-31',
  '2027-01-01',
  '2027-02-08',
  '2027-03-01',
  '2027-05-05',
  '2027-05-13',
  '2027-06-07',
  '2027-08-16',
  '2027-10-14',
  '2027-10-15',
  '2027-12-31',
]);

const KNOWN_KRX_PARTIAL_CLOSE_MINUTES = new Map<string, number>([
  // Last KRX trading day commonly closes early. Keep this table explicit
  // until the Phase 5 calendar source is migrated to DB.
  ['2026-12-30', 12 * 60 + 30],
]);

const KRX_OPEN_MINUTE = 9 * 60;
const KRX_CONTINUOUS_CLOSE_MINUTE = 15 * 60 + 20;
export const KRX_CALENDAR_CHANGED_CHANNEL = 'chart_archive:krx_calendar_changed';

@Injectable()
export class KrxCalendarService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(KrxCalendarService.name);
  private readonly dbDays = new Map<string, CalendarDay>();
  private listenerAttached = false;

  constructor(
    @Optional() @InjectDataSource() private readonly dataSource?: DataSource,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: RedisClientToken,
    @Optional() @Inject(REDIS_SUBSCRIBER) private readonly subscriber?: RedisClientToken,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshFromDb();
    await this.subscribeCalendarChanges();
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.subscriber) return;
    await this.subscriber.unsubscribe(KRX_CALENDAR_CHANGED_CHANNEL).catch((err) => {
      this.logger.warn(`unsubscribe ${KRX_CALENDAR_CHANGED_CHANNEL} failed: ${err instanceof Error ? err.message : err}`);
    });
  }

  async refreshFromDb(): Promise<void> {
    if (!this.dataSource) return;
    try {
      const rows = (await this.dataSource.query(
        `
          SELECT
            trade_date::text AS "tradeDate",
            is_trading_day AS "isTradingDay",
            session_open_kst AS "sessionOpenKst",
            session_close_kst AS "sessionCloseKst",
            is_partial_day AS "isPartialDay",
            source,
            holiday_name AS "holidayName",
            notes,
            revision
          FROM krx_calendar
        `,
      )) as CalendarDay[];
      this.dbDays.clear();
      for (const row of rows) this.dbDays.set(row.tradeDate, row);
    } catch (err) {
      this.logger.warn(`krx_calendar DB load failed; using hardcoded fallback: ${err instanceof Error ? err.message : err}`);
    }
  }

  async upsertManualOverride(input: {
    tradeDate: string;
    isTradingDay: boolean;
    sessionOpenKst?: string | null;
    sessionCloseKst?: string | null;
    holidayName?: string | null;
    notes?: string | null;
    actor?: string | null;
  }): Promise<void> {
    if (!this.dataSource) throw new Error('DataSource is required for KRX calendar override');
    const sessionOpenKst = input.isTradingDay ? input.sessionOpenKst ?? '09:00' : null;
    const sessionCloseKst = input.isTradingDay ? input.sessionCloseKst ?? '15:20' : null;
    const isPartialDay = input.isTradingDay && sessionCloseKst !== '15:20';
    await this.dataSource.query(
      `
        INSERT INTO krx_calendar (
          trade_date, is_trading_day, session_open_kst, session_close_kst,
          is_partial_day, source, holiday_name, notes, revision,
          source_updated_at, last_synced_at, updated_by, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'manual_override', $6, $7, 1, NOW(), NOW(), $8, NOW(), NOW())
        ON CONFLICT (trade_date)
        DO UPDATE SET
          is_trading_day = EXCLUDED.is_trading_day,
          session_open_kst = EXCLUDED.session_open_kst,
          session_close_kst = EXCLUDED.session_close_kst,
          is_partial_day = EXCLUDED.is_partial_day,
          source = 'manual_override',
          holiday_name = EXCLUDED.holiday_name,
          notes = EXCLUDED.notes,
          revision = krx_calendar.revision + 1,
          source_updated_at = NOW(),
          last_synced_at = NOW(),
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
      `,
      [
        input.tradeDate,
        input.isTradingDay,
        sessionOpenKst,
        sessionCloseKst,
        isPartialDay,
        input.holidayName ?? null,
        input.notes ?? null,
        input.actor ?? null,
      ],
    );
    await this.refreshFromDb();
    await this.publishCalendarChanged({ reason: 'manual_override', tradeDate: input.tradeDate });
  }

  async publishCalendarChanged(metadata: Record<string, unknown>): Promise<void> {
    await this.redis
      ?.publish(KRX_CALENDAR_CHANGED_CHANNEL, JSON.stringify(metadata))
      .catch((err) => {
        this.logger.warn(`KRX calendar change publish failed: ${err instanceof Error ? err.message : err}`);
      });
  }

  isTradingDay(tradeDate: string): boolean {
    const row = this.dbDays.get(tradeDate);
    if (row) return row.isTradingDay;
    if (requireDbCalendar()) {
      throw new Error(`krx_calendar missing tradeDate=${tradeDate}`);
    }
    const date = new Date(`${tradeDate}T00:00:00.000Z`);
    const day = date.getUTCDay();
    if (day === 0 || day === 6) return false;
    return !KNOWN_KRX_HOLIDAYS.has(tradeDate);
  }

  expectedOneMinuteRows(tradeDate: string): number {
    if (!this.isTradingDay(tradeDate)) return 0;
    return this.sessionCloseMinute(tradeDate) - KRX_OPEN_MINUTE;
  }

  expectedHourlyRows(tradeDate: string): number {
    if (!this.isTradingDay(tradeDate)) return 0;
    return Math.ceil(this.expectedOneMinuteRows(tradeDate) / 60);
  }

  expectedHourlyRowsInMonth(month: string, untilTradeDate: string): number {
    return this.tradingDaysInRange(`${month}-01`, untilTradeDate).reduce(
      (sum, day) => sum + this.expectedHourlyRows(day),
      0,
    );
  }

  expectedDailyRowsInYear(year: string, untilTradeDate: string): number {
    return this.tradingDaysInRange(`${year}-01-01`, untilTradeDate).length;
  }

  private sessionCloseMinute(tradeDate: string): number {
    const row = this.dbDays.get(tradeDate);
    if (row?.sessionCloseKst) return parseKstMinute(row.sessionCloseKst);
    return KNOWN_KRX_PARTIAL_CLOSE_MINUTES.get(tradeDate) ?? KRX_CONTINUOUS_CLOSE_MINUTE;
  }

  private tradingDaysInRange(fromTradeDate: string, toTradeDateInclusive: string): string[] {
    const out: string[] = [];
    const cursor = new Date(`${fromTradeDate}T00:00:00.000Z`);
    const end = new Date(`${toTradeDateInclusive}T00:00:00.000Z`);
    while (cursor.getTime() <= end.getTime()) {
      const day = cursor.toISOString().slice(0, 10);
      if (this.isTradingDay(day)) out.push(day);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }

  private async subscribeCalendarChanges(): Promise<void> {
    if (!this.subscriber) return;
    if (!this.listenerAttached) {
      this.subscriber.on('message', (channel: string) => {
        if (channel !== KRX_CALENDAR_CHANGED_CHANNEL) return;
        this.refreshFromDb().catch((err) => {
          this.logger.warn(`KRX calendar refresh after pubsub failed: ${err instanceof Error ? err.message : err}`);
        });
      });
      this.listenerAttached = true;
    }
    await this.subscriber.subscribe(KRX_CALENDAR_CHANGED_CHANNEL).catch((err) => {
      this.logger.warn(`subscribe ${KRX_CALENDAR_CHANGED_CHANNEL} failed: ${err instanceof Error ? err.message : err}`);
    });
  }
}

function requireDbCalendar(): boolean {
  const value = process.env.CHART_ARCHIVE_CALENDAR_REQUIRE_DB?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

interface CalendarDay {
  tradeDate: string;
  isTradingDay: boolean;
  sessionOpenKst: string | null;
  sessionCloseKst: string | null;
  isPartialDay: boolean;
  source: string;
  holidayName: string | null;
  notes: string | null;
  revision: number;
}

function parseKstMinute(hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map((part) => Number(part));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return KRX_CONTINUOUS_CLOSE_MINUTE;
  return hh * 60 + mm;
}
