/* eslint-disable no-console */
import { config as loadDotenv } from 'dotenv';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

// Sequential migration runner. Reads migrations/*.sql in lexical order
// and applies each file inside a transaction. Already-applied files
// (tracked in schema_migrations) are skipped.

loadDotenv({ path: '.env.local', override: true });
loadDotenv();

async function main(): Promise<void> {
  const databaseUrl = process.env.WORKER_DATABASE_URL;

  if (!databaseUrl) throw new Error('WORKER_DATABASE_URL is required');

  const migrationsDir = resolve(__dirname, '..', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('migrate: no .sql files found in migrations/');

    return;
  }

  const sslmodeNoVerify = databaseUrl.includes('sslmode=no-verify');
  const sslmodeRequire = databaseUrl.includes('sslmode=require');
  const ssl = sslmodeNoVerify || sslmodeRequire ? { rejectUnauthorized: false } : undefined;

  const client = new Client({ connectionString: databaseUrl, ssl });

  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(256) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set<string>();
    const existing = (await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    )).rows;

    for (const r of existing) applied.add(r.filename);

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`migrate: skip ${file} (already applied)`);

        continue;
      }

      const sql = readFileSync(join(migrationsDir, file), 'utf8');

      console.log(`migrate: apply ${file}`);

      await client.query('BEGIN');

      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [file]);
        await client.query('COMMIT');

        console.log(`migrate: ok    ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('migrate: all done');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('migrate failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
