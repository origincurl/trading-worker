import { DynamicModule, Module, type Type } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from '@admin/admin.module';
import { ConfigModule, type ValidatedConfig } from '@config/config.module';
import type { WorkerRole } from '@config/runtime.config';
import { HealthModule } from '@health/health.module';
import { CalculatorModule } from '@roles/calculator/calculator.module';
import { CollectorModule } from '@roles/collector/collector.module';
import { DetectorModule } from '@roles/detector/detector.module';
import { ExecutorModule } from '@roles/executor/executor.module';
import { BusModule } from '@shared/bus/bus.module';
import { RedisModule } from '@shared/cache/redis.module';
import { EventModule } from '@shared/event/event.module';
import { PersistenceModule } from '@shared/persistence/persistence.module';

// External vendor / BE modules are deliberately NOT imported here. Each
// role module pulls in only what it needs (architecture.md §10): a
// `ROLES=detector` deploy must not instantiate BrokerageModule (collector
// rate budget) and a `ROLES=collector` deploy must not instantiate
// NotifyModule. Role-scoped imports give us that gate for free.
const ROLE_MODULES: Record<WorkerRole, Type<unknown>> = {
  collector: CollectorModule,
  calculator: CalculatorModule,
  executor: ExecutorModule,
  detector: DetectorModule,
};

@Module({})
export class AppModule {
  static register(config: ValidatedConfig): DynamicModule {
    const roleModules = config.runtime.roles.map((role) => ROLE_MODULES[role]);

    return {
      module: AppModule,
      imports: [
        ConfigModule.register(config),
        PersistenceModule.register(config.persistence),
        RedisModule,
        BusModule,
        EventModule,
        // ScheduleModule.forRoot() MUST be registered exactly once at the
        // root so @Interval handlers don't double-fire. Previously each
        // role module imported it, which made every scheduler tick twice
        // when collector + detector were loaded together.
        ScheduleModule.forRoot(),
        HealthModule,
        AdminModule,
        ...roleModules,
      ],
    };
  }
}
