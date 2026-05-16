import { Global, Logger, Module, type DynamicModule } from '@nestjs/common';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { types as pgTypes } from 'pg';
import { type PersistenceConfig } from '@config/persistence.config';
import { SnakeNamingStrategy } from './snake-naming.strategy';

// Postgres returns bigint (OID 20) as a string by default to preserve
// 64-bit precision. Our row ids stay inside Number.MAX_SAFE_INTEGER, so
// coercing matches the entity typings — same trick as trading-be.
pgTypes.setTypeParser(20, (value) => Number(value));

@Global()
@Module({})
export class PersistenceModule {
  static register(config: PersistenceConfig): DynamicModule {
    const logger = new Logger(PersistenceModule.name);

    if (!config.databaseUrl) {
      logger.warn(
        'WORKER_DATABASE_URL not set — PersistenceModule running in disabled mode (no DataSource).',
      );

      return { module: PersistenceModule };
    }

    const typeormOptions: TypeOrmModuleOptions = {
      type: 'postgres',
      url: config.databaseUrl,
      autoLoadEntities: true,
      synchronize: false,
      namingStrategy: new SnakeNamingStrategy(),
      retryAttempts: 0,
      ssl:
        config.databaseUrl.includes('sslmode=no-verify') ||
        config.databaseUrl.includes('sslmode=require')
          ? { rejectUnauthorized: false }
          : false,
    };

    return {
      module: PersistenceModule,
      imports: [TypeOrmModule.forRoot(typeormOptions)],
      exports: [TypeOrmModule],
    };
  }
}
