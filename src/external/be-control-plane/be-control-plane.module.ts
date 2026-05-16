import { Global, Logger, Module, type Provider } from '@nestjs/common';
import {
  BE_CONTROL_PLANE_CONFIG,
  type BeControlPlaneConfig,
} from '@config/be-control-plane.config';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { BE_CONTROL_PLANE_CLIENT } from './client/be-control-plane.client';
import { BeControlPlaneSigner } from './client/be-control-plane.signer';
import { HttpBeControlPlaneClient } from './client/http-be-control-plane.client';
import { MockBeControlPlaneClient } from './client/mock-be-control-plane.client';

const beClientProvider: Provider = {
  provide: BE_CONTROL_PLANE_CLIENT,
  inject: [BE_CONTROL_PLANE_CONFIG, RUNTIME_CONFIG],
  useFactory: (config: BeControlPlaneConfig, runtime: RuntimeConfig) => {
    const logger = new Logger('BeControlPlaneModule');

    if (config.mock) {
      logger.warn(
        'BE_CONTROL_PLANE_MOCK=true — using in-memory MockBeControlPlaneClient. Do NOT enable in production.',
      );

      return new MockBeControlPlaneClient();
    }

    const signer = new BeControlPlaneSigner({
      workerId: runtime.workerInstanceId,
      hmacSecret: config.hmacSecret,
    });

    return new HttpBeControlPlaneClient({
      baseUrl: config.url,
      signer,
    });
  },
};

@Global()
@Module({
  providers: [beClientProvider],
  exports: [BE_CONTROL_PLANE_CLIENT],
})
export class BeControlPlaneModule {}
