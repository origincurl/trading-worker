import { Global, Module } from '@nestjs/common';
import { ADMIN_CONFIG, loadAdminConfig } from './admin.config';
import { BE_CONTROL_PLANE_CONFIG, loadBeControlPlaneConfig } from './be-control-plane.config';
import { COLLECTOR_CONFIG, loadCollectorConfig } from './collector.config';
import { KIWOOM_CONFIG, loadKiwoomConfig } from './kiwoom.config';
import { NOTIFY_CONFIG, loadNotifyConfig } from './notify.config';
import { PERSISTENCE_CONFIG, loadPersistenceConfig } from './persistence.config';
import { REDIS_CONFIG, loadRedisConfig } from './redis.config';
import { RUNTIME_CONFIG, loadRuntimeConfig, type RuntimeConfig } from './runtime.config';

export function validateEnv(env: NodeJS.ProcessEnv) {
  const runtime = loadRuntimeConfig(env);
  const persistence = loadPersistenceConfig(env);
  const redis = loadRedisConfig(env);
  const kiwoom = loadKiwoomConfig(env, runtime.roles);
  const beControlPlane = loadBeControlPlaneConfig(env);
  const notify = loadNotifyConfig(env);
  const collector = loadCollectorConfig(env);
  const admin = loadAdminConfig(env);

  return { runtime, persistence, redis, kiwoom, beControlPlane, notify, collector, admin };
}

export type ValidatedConfig = ReturnType<typeof validateEnv>;

@Global()
@Module({})
export class ConfigModule {
  static register(config: ValidatedConfig) {
    return {
      module: ConfigModule,
      providers: [
        { provide: RUNTIME_CONFIG, useValue: config.runtime },
        { provide: PERSISTENCE_CONFIG, useValue: config.persistence },
        { provide: REDIS_CONFIG, useValue: config.redis },
        { provide: KIWOOM_CONFIG, useValue: config.kiwoom },
        { provide: BE_CONTROL_PLANE_CONFIG, useValue: config.beControlPlane },
        { provide: NOTIFY_CONFIG, useValue: config.notify },
        { provide: COLLECTOR_CONFIG, useValue: config.collector },
        { provide: ADMIN_CONFIG, useValue: config.admin },
      ],
      exports: [
        RUNTIME_CONFIG,
        PERSISTENCE_CONFIG,
        REDIS_CONFIG,
        KIWOOM_CONFIG,
        BE_CONTROL_PLANE_CONFIG,
        NOTIFY_CONFIG,
        COLLECTOR_CONFIG,
        ADMIN_CONFIG,
      ],
    };
  }
}

export type { RuntimeConfig };
