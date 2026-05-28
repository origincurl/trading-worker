import { Global, Module } from '@nestjs/common';
import { ADMIN_CONFIG, loadAdminConfig } from './admin.config';
import { CHART_ARCHIVE_CONFIG, loadChartArchiveConfig } from './chart-archive.config';
import { COLLECTOR_CONFIG, loadCollectorConfig } from './collector.config';
import { TRACKER_CONFIG, loadTrackerConfig } from './tracker.config';
import { KIWOOM_CONFIG, loadKiwoomConfig } from './kiwoom.config';
import { NOTIFIER_CONFIG, loadNotifierConfig } from './notifier.config';
import { NOTIFY_CONFIG, loadNotifyConfig } from './notify.config';
import { PERSISTENCE_CONFIG, loadPersistenceConfig } from './persistence.config';
import { REDIS_CONFIG, loadRedisConfig } from './redis.config';
import { RUNTIME_CONFIG, loadRuntimeConfig, type RuntimeConfig } from './runtime.config';

export function validateEnv(env: NodeJS.ProcessEnv) {
  const runtime = loadRuntimeConfig(env);
  const persistence = loadPersistenceConfig(env);
  const redis = loadRedisConfig(env);
  const kiwoom = loadKiwoomConfig(env);
  const notify = loadNotifyConfig(env);
  const collector = loadCollectorConfig(env);
  const chartArchive = loadChartArchiveConfig(env);
  const tracker = loadTrackerConfig(env);
  const notifier = loadNotifierConfig(env);
  const admin = loadAdminConfig(env);

  return {
    runtime,
    persistence,
    redis,
    kiwoom,
    notify,
    collector,
    chartArchive,
    tracker,
    notifier,
    admin,
  };
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
        { provide: NOTIFY_CONFIG, useValue: config.notify },
        { provide: COLLECTOR_CONFIG, useValue: config.collector },
        { provide: CHART_ARCHIVE_CONFIG, useValue: config.chartArchive },
        { provide: TRACKER_CONFIG, useValue: config.tracker },
        { provide: NOTIFIER_CONFIG, useValue: config.notifier },
        { provide: ADMIN_CONFIG, useValue: config.admin },
      ],
      exports: [
        RUNTIME_CONFIG,
        PERSISTENCE_CONFIG,
        REDIS_CONFIG,
        KIWOOM_CONFIG,
        NOTIFY_CONFIG,
        COLLECTOR_CONFIG,
        CHART_ARCHIVE_CONFIG,
        TRACKER_CONFIG,
        NOTIFIER_CONFIG,
        ADMIN_CONFIG,
      ],
    };
  }
}

export type { RuntimeConfig };
