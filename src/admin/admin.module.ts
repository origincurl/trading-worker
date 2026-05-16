import { Module } from '@nestjs/common';
import { BeControlPlaneModule } from '@external/be-control-plane/be-control-plane.module';
import { AdminCredentialsController } from './controller/admin-credentials.controller';
import { AdminInfoController } from './controller/admin-info.controller';
import { AdminJobsController } from './controller/admin-jobs.controller';
import { AdminWsController } from './controller/admin-ws.controller';
import { AdminAuthGuard } from './guard/admin-auth.guard';
import { GetAdminInfoUsecase } from './usecase/get-admin-info.usecase';
import { TestCredentialsUsecase } from './usecase/test-credentials.usecase';
import { TriggerAdminJobUsecase } from './usecase/trigger-admin-job.usecase';
import { TriggerWsReconnectUsecase } from './usecase/trigger-ws-reconnect.usecase';

// architecture.md §9, §13: admin endpoints are ops-internal only, never
// exposed to FE. Bearer token guards every route; without ADMIN_TOKEN
// env the guard refuses all requests.
//
// AdminModule loads regardless of ROLES — the controllers degrade
// gracefully when the role-specific dependency they want to trigger is
// absent (see trigger-admin-job.usecase.ts).
@Module({
  imports: [BeControlPlaneModule],
  controllers: [
    AdminInfoController,
    AdminCredentialsController,
    AdminJobsController,
    AdminWsController,
  ],
  providers: [
    AdminAuthGuard,
    GetAdminInfoUsecase,
    TestCredentialsUsecase,
    TriggerAdminJobUsecase,
    TriggerWsReconnectUsecase,
  ],
})
export class AdminModule {}
