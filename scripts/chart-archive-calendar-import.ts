import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { Client } from 'pg';
import { config as loadDotenv } from 'dotenv';

interface Row {
  tradeDate: string;
  isTradingDay: boolean;
  sessionOpenKst: string | null;
  sessionCloseKst: string | null;
  holidayName: string | null;
  notes: string | null;
}

async function main(): Promise<void> {
  loadDotenv({ path: '.env.local', override: true });
  loadDotenv();
  const file = arg('--file');
  if (!file) throw new Error('usage: npm run chart:calendar-import -- --file krx-calendar.csv');
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const client = new Client({ connectionString: process.env.WORKER_DATABASE_URL });
  await client.connect();
  const syncRunId = randomUUID();
  await client.query(
    `INSERT INTO krx_calendar_sync_runs (id, started_at, source, status, revision)
     VALUES ($1, NOW(), 'manual_csv', 'RUNNING', 1)`,
    [syncRunId],
  );
  let affected = 0;
  try {
    for (const row of rows) {
      const isPartialDay = row.isTradingDay && row.sessionCloseKst !== null && row.sessionCloseKst !== '15:20';
      await client.query(
        `
          INSERT INTO krx_calendar (
            trade_date, is_trading_day, session_open_kst, session_close_kst,
            is_partial_day, source, holiday_name, notes, revision,
            source_updated_at, last_synced_at, updated_by, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, 'manual_csv', $6, $7, 1, NOW(), NOW(), 'calendar-import', NOW(), NOW())
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
        `,
        [
          row.tradeDate,
          row.isTradingDay,
          row.sessionOpenKst,
          row.sessionCloseKst,
          isPartialDay,
          row.holidayName,
          row.notes,
        ],
      );
      affected += 1;
    }
    await client.query(
      `UPDATE krx_calendar_sync_runs SET status='SUCCESS', finished_at=NOW(), affected_rows=$2 WHERE id=$1`,
      [syncRunId, affected],
    );
    console.log(JSON.stringify({ ok: true, syncRunId, affectedRows: affected }));
  } catch (err) {
    await client.query(
      `UPDATE krx_calendar_sync_runs SET status='FAILED', finished_at=NOW(), error_message=$2 WHERE id=$1`,
      [syncRunId, err instanceof Error ? err.message : String(err)],
    );
    throw err;
  } finally {
    await client.end();
  }
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const [headerLine, ...dataLines] = lines;
  const headers = headerLine.split(',').map((item) => item.trim());
  return dataLines.map((line) => {
    const values = line.split(',').map((item) => item.trim());
    const obj = Object.fromEntries(headers.map((key, i) => [key, values[i] ?? '']));
    const isTradingDay = parseBool(obj.isTradingDay ?? obj.is_trading_day);
    return {
      tradeDate: obj.tradeDate ?? obj.trade_date,
      isTradingDay,
      sessionOpenKst: isTradingDay ? obj.sessionOpenKst || obj.session_open_kst || '09:00' : null,
      sessionCloseKst: isTradingDay ? obj.sessionCloseKst || obj.session_close_kst || '15:20' : null,
      holidayName: obj.holidayName || obj.holiday_name || null,
      notes: obj.notes || null,
    };
  });
}

function parseBool(raw: unknown): boolean {
  const value = String(raw).trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'y' || value === 'yes';
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
