import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadDotenv } from 'dotenv';
import 'reflect-metadata';
import { Brokerage } from '../src/shared/model/account/brokerage.enum';
import { MarketEnv } from '../src/shared/model/api-credential/market-env.enum';
import { COLLECTOR_CREDENTIAL_REPOSITORY } from '../src/shared/persistence/collector-credential/collector-credential.token';
import type { CollectorCredentialRepository } from '../src/shared/persistence/collector-credential/collector-credential.repository';
import { ConfigModule, validateEnv } from '../src/config/config.module';
import { KIWOOM_CONFIG, KiwoomMarketEnv, type KiwoomConfig } from '../src/config/kiwoom.config';
import { PersistenceModule } from '../src/shared/persistence/persistence.module';
import { CryptoModule } from '../src/shared/crypto/crypto.module';
import { CredentialEncryptionService } from '../src/shared/crypto/credential-encryption.service';
import { KiwoomTokenService } from '../src/external/brokerage/platforms/kiwoom/auth/kiwoom-token.service';
import type { FetchChartCandlesResponseContract } from '../src/external/brokerage/platforms/kiwoom/contract/response/fetch-chart-candles.response';

const API_ID = 'ka10080';
const PATH_CHART = '/api/dostk/chart';
const DEFAULT_SYMBOL = '005930';

@Module({})
class ProbeModule {
  static register(config: ReturnType<typeof validateEnv>) {
    return {
      module: ProbeModule,
      imports: [
        ConfigModule.register(config),
        PersistenceModule.register(config.persistence),
        CryptoModule,
      ],
      providers: [KiwoomTokenService],
    };
  }
}

async function main() {
  loadDotenv({ path: '.env.local', override: false });
  loadDotenv();

  if (process.env.NODE_ENV === 'production' && process.env.PROBE_FORCE !== 'true') {
    throw new Error(
      'Refusing to run Kiwoom chart probe in production. Set PROBE_FORCE=true to override explicitly.',
    );
  }

  const logger = new Logger('KiwoomChartRangeProbe');
  const config = validateEnv(process.env);
  const app = await NestFactory.createApplicationContext(ProbeModule.register(config), {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const kiwoom = app.get<KiwoomConfig>(KIWOOM_CONFIG);
    const repository = app.get<CollectorCredentialRepository>(COLLECTOR_CREDENTIAL_REPOSITORY);
    const encryption = app.get(CredentialEncryptionService);
    const tokenService = app.get(KiwoomTokenService);
    const marketEnv =
      kiwoom.marketEnv === KiwoomMarketEnv.Mock ? MarketEnv.Mock : MarketEnv.Production;
    const credential = (
      await repository.findActive(Brokerage.Kiwoom, marketEnv)
    ).find((item) => item.id === Number(process.env.PROBE_CREDENTIAL_ID)) ??
      (await repository.findActive(Brokerage.Kiwoom, marketEnv))[0];

    if (!kiwoom.restUrl) throw new Error('KIWOOM_REST_URL is required');
    if (!credential) throw new Error(`no ACTIVE collector credential for ${Brokerage.Kiwoom}/${marketEnv}`);

    const appKey = encryption.decrypt(credential.appKeyEnc);
    const appSecret = encryption.decrypt(credential.appSecretEnc);
    if (!appKey || !appSecret) throw new Error(`missing appKey/appSecret credentialId=${credential.id}`);

    const token = await tokenService.issueAccessToken({
      kind: 'collector',
      credentialId: credential.id,
      brokerage: credential.brokerage,
      marketEnv: credential.marketEnv,
      appKey,
      appSecret,
    });

    const symbol = process.env.PROBE_SYMBOL ?? DEFAULT_SYMBOL;
    const baseDt = process.env.PROBE_BASE_DT ?? kstYyyyMmDd(new Date());
    const restUrl = `${kiwoom.restUrl.replace(/\/+$/, '')}${PATH_CHART}`;

    logger.log(
      `requesting ka10080 credentialId=${credential.id} env=${marketEnv} symbol=${symbol} baseDt=${baseDt}`,
    );

    const response = await fetch(restUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        authorization: `Bearer ${token.accessToken}`,
        'api-id': API_ID,
        'cont-yn': 'N',
        'next-key': '',
      },
      body: JSON.stringify({
        stk_cd: symbol,
        base_dt: baseDt,
        tic_scope: '1',
        upd_stkpc_tp: '1',
      }),
    });
    const raw = await response.text();
    const parsed = raw ? (JSON.parse(raw) as FetchChartCandlesResponseContract) : {};
    const rows = parsed.stk_min_pole_chart_qry ?? [];
    const byDay = new Map<string, number>();
    const times: string[] = [];

    for (const row of rows) {
      const rawTime = row.cntr_tm ?? row.dt;
      if (!rawTime) continue;
      const day = rawTime.slice(0, 8);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      times.push(rawTime);
    }

    times.sort();
    logger.log(
      `status=${response.status} rows=${rows.length} days=${byDay.size} first=${times[0] ?? '-'} last=${times.at(-1) ?? '-'}`,
    );
    logger.log(
      `days=${Array.from(byDay.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, count]) => `${day}:${count}`)
        .join(',') || '-'}`,
    );
  } finally {
    await app.close();
  }
}

function kstYyyyMmDd(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(value)
    .replace(/-/g, '');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
