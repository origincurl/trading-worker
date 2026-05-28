import { DynamicModule, Global, Inject, Module, Optional, type OnModuleDestroy, type Provider } from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';
import { BrokerageModule } from '@external/brokerage/brokerage.module';
import { ConfigModule, type ValidatedConfig } from '@config/config.module';
import { REDIS_CONFIG, type RedisConfig } from '@config/redis.config';
import { CryptoModule } from '@shared/crypto/crypto.module';
import { EventModule } from '@shared/event/event.module';
import { PersistenceModule } from '@shared/persistence/persistence.module';
import { BusModule } from '@shared/bus/bus.module';
import { REDIS_CLIENT, REDIS_SUBSCRIBER, type RedisClientToken } from '@shared/cache/redis.tokens';
import { ChartArchiveAlertService } from '@roles/collector/chart-archive/chart-archive-alert.service';
import { ChartArchiveManifestRepository } from '@roles/collector/chart-archive/chart-archive-manifest.repository';
import { ChartArchiveS3Service } from '@roles/collector/chart-archive/chart-archive-s3.service';
import { ChartArchiveTaskRepository } from '@roles/collector/chart-archive/chart-archive-task.repository';
import { ChartArchiveWriterService } from '@roles/collector/chart-archive/chart-archive-writer.service';
import { KrxCalendarService } from '@roles/collector/chart-archive/krx-calendar.service';
import { SyncStockListUsecase } from '@roles/collector/usecase/sync-stock-list.usecase';

const REDIS_CONNECT_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: null,
  enableAutoPipelining: true,
  lazyConnect: true,
};

const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [REDIS_CONFIG],
  useFactory: (config: RedisConfig): RedisClientToken =>
    config.url ? new Redis(config.url, REDIS_CONNECT_OPTIONS) : undefined,
};

const redisSubscriberProvider: Provider = {
  provide: REDIS_SUBSCRIBER,
  inject: [REDIS_CONFIG],
  useFactory: (config: RedisConfig): RedisClientToken =>
    config.url ? new Redis(config.url, REDIS_CONNECT_OPTIONS) : undefined,
};

@Global()
@Module({
  providers: [redisClientProvider, redisSubscriberProvider],
  exports: [REDIS_CLIENT, REDIS_SUBSCRIBER],
})
class ArchiveOpsRedisModule implements OnModuleDestroy {
  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly client?: RedisClientToken,
    @Optional() @Inject(REDIS_SUBSCRIBER) private readonly subscriber?: RedisClientToken,
  ) {}

  async onModuleDestroy(): Promise<void> {
    this.client?.disconnect();
    this.subscriber?.disconnect();
  }
}

@Module({})
export class ArchiveOpsModule {

  static register(config: ValidatedConfig): DynamicModule {
    return {
      module: ArchiveOpsModule,
      imports: [
        ConfigModule.register(config),
        PersistenceModule.register(config.persistence),
        ArchiveOpsRedisModule,
        CryptoModule,
        EventModule,
        BusModule,
        BrokerageModule,
      ],
      providers: [
        redisClientProvider,
        redisSubscriberProvider,
        KrxCalendarService,
        ChartArchiveAlertService,
        ChartArchiveS3Service,
        ChartArchiveManifestRepository,
        ChartArchiveTaskRepository,
        ChartArchiveWriterService,
        SyncStockListUsecase,
      ],
      exports: [ChartArchiveWriterService],
    };
  }
}
