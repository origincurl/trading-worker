import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadDotenv } from 'dotenv';
import 'reflect-metadata';
import { Brokerage } from '../src/shared/model/account/brokerage.enum';
import { MarketEnv } from '../src/shared/model/api-credential/market-env.enum';
import { COLLECTOR_CREDENTIAL_REPOSITORY } from '../src/shared/persistence/collector-credential/collector-credential.token';
import type { CollectorCredentialRepository } from '../src/shared/persistence/collector-credential/collector-credential.repository';
import { ConfigModule, validateEnv } from '../src/config/config.module';
import { KiwoomMarketEnv, KIWOOM_CONFIG, type KiwoomConfig } from '../src/config/kiwoom.config';
import { PersistenceModule } from '../src/shared/persistence/persistence.module';
import { CryptoModule } from '../src/shared/crypto/crypto.module';
import { CredentialEncryptionService } from '../src/shared/crypto/credential-encryption.service';
import { KiwoomTokenService } from '../src/external/brokerage/platforms/kiwoom/auth/kiwoom-token.service';
import { KiwoomWsClient } from '../src/external/brokerage/platforms/kiwoom/kiwoom-ws.client';

interface ProbeResult {
  readonly credentialId: number;
  readonly label: string;
  readonly ok: boolean;
  readonly connected: boolean;
  readonly loginAck: boolean;
  readonly close?: { code: number; reason: string };
  readonly error?: string;
}

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

const HOLD_MS = Number(process.env.PROBE_HOLD_MS ?? 15_000);
const LOGIN_ACK_TIMEOUT_MS = Number(process.env.PROBE_LOGIN_ACK_TIMEOUT_MS ?? 5_000);
const CREDENTIAL_IDS = parseCredentialIds(process.env.PROBE_CREDENTIAL_IDS);
const REG_SYMBOLS = parseList(process.env.PROBE_REG_SYMBOLS);
const REG_TYPES = parseList(process.env.PROBE_REG_TYPES ?? '0B');

async function main() {
  loadDotenv({ path: '.env.local', override: false });
  loadDotenv();

  if (process.env.NODE_ENV === 'production' && process.env.PROBE_FORCE !== 'true') {
    throw new Error('Refusing to run Kiwoom WS probe in production. Set PROBE_FORCE=true to override explicitly.');
  }

  const logger = new Logger('KiwoomWsConcurrencyProbe');
  const config = validateEnv(process.env);
  const app = await NestFactory.createApplicationContext(ProbeModule.register(config), {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const repository = app.get<CollectorCredentialRepository>(COLLECTOR_CREDENTIAL_REPOSITORY);
    const encryption = app.get(CredentialEncryptionService);
    const tokenService = app.get(KiwoomTokenService);
    const kiwoom = app.get<KiwoomConfig>(KIWOOM_CONFIG);
    const marketEnv = kiwoom.marketEnv === KiwoomMarketEnv.Mock ? MarketEnv.Mock : MarketEnv.Production;
    const credentials = (await repository.findActive(Brokerage.Kiwoom, marketEnv)).filter(
      (credential) => CREDENTIAL_IDS.size === 0 || CREDENTIAL_IDS.has(credential.id),
    );

    if (!kiwoom.wsUrl) throw new Error('KIWOOM_WS_URL is required');
    if (credentials.length === 0) throw new Error(`no ACTIVE collector credentials for ${Brokerage.Kiwoom}/${marketEnv}`);

    logger.log(
      `probing ${credentials.length} collector WS connection(s) env=${marketEnv} holdMs=${HOLD_MS} regSymbols=${REG_SYMBOLS.join(',') || '-'}`,
    );

    const results = await Promise.all(
      credentials.map(async (credential) => {
        const appKey = encryption.decrypt(credential.appKeyEnc);
        const appSecret = encryption.decrypt(credential.appSecretEnc);

        if (!appKey || !appSecret) {
          return {
            credentialId: credential.id,
            label: credential.label,
            ok: false,
            connected: false,
            loginAck: false,
            error: 'missing appKey/appSecret material',
          } satisfies ProbeResult;
        }

        const token = await tokenService.issueAccessToken({
          credentialId: credential.id,
          brokerage: credential.brokerage,
          marketEnv: credential.marketEnv,
          appKey,
          appSecret,
        });

        return probeOne(kiwoom.wsUrl as string, credential.id, credential.label, token.accessToken);
      }),
    );

    for (const result of results) {
      const status = result.ok ? 'OK' : 'FAIL';
      const close = result.close ? ` close=${result.close.code}/${result.close.reason || '-'}` : '';
      const error = result.error ? ` error=${result.error}` : '';
      logger.log(
        `${status} credentialId=${result.credentialId} label="${result.label}" connected=${result.connected} loginAck=${result.loginAck}${close}${error}`,
      );
    }

    const okCount = results.filter((result) => result.ok).length;
    logger.log(`summary ok=${okCount}/${results.length}`);
  } finally {
    await app.close();
  }
}

async function probeOne(
  wsUrl: string,
  credentialId: number,
  label: string,
  token: string,
): Promise<ProbeResult> {
  const client = new KiwoomWsClient({
    profile: 'collector',
    wsUrl,
    tokenSupplier: async () => token,
    connectTimeoutMs: 10_000,
    closeTimeoutMs: 2_000,
  });
  let close: ProbeResult['close'];
  let loginAck = false;

  client.onClose((code, reason) => {
    close = { code, reason };
  });

  try {
    await client.connect();

    const ack = waitForLoginAck(client);
    await client.send({ trnm: 'LOGIN', token });
    await ack;
    loginAck = true;

    if (REG_SYMBOLS.length > 0) {
      await client.send({
        trnm: 'REG',
        grp_no: String(credentialId),
        refresh: '1',
        data: [{ item: REG_SYMBOLS, type: REG_TYPES }],
      });
    }

    await sleep(HOLD_MS);

    const connected = client.isConnected();
    await client.disconnect(1000, 'probe-complete');

    return {
      credentialId,
      label,
      ok: connected && loginAck,
      connected,
      loginAck,
      close,
    };
  } catch (err) {
    await client.disconnect(1000, 'probe-error').catch(() => undefined);

    return {
      credentialId,
      label,
      ok: false,
      connected: client.isConnected(),
      loginAck,
      close,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function waitForLoginAck(client: KiwoomWsClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`LOGIN ack timeout after ${LOGIN_ACK_TIMEOUT_MS}ms`));
    }, LOGIN_ACK_TIMEOUT_MS);

    const cleanup = client.onMessage((parsed) => {
      if (!isRecord(parsed) || parsed.trnm !== 'LOGIN') return;

      cleanup();
      clearTimeout(timer);

      const returnCode = parsed.return_code;
      if (returnCode === undefined || returnCode === null || returnCode === 0 || returnCode === '0') {
        resolve();
        return;
      }

      reject(new Error(`LOGIN rejected return_code=${String(returnCode)} return_msg=${String(parsed.return_msg ?? '')}`));
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCredentialIds(raw: string | undefined): Set<number> {
  if (!raw?.trim()) return new Set();

  return new Set(
    raw
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isInteger(value) && value > 0),
  );
}

function parseList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];

  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
