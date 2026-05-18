import { Inject, Injectable, Logger, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { RUNTIME_CONFIG, type RuntimeConfig, type WorkerRole } from '@config/runtime.config';
import { CandleFlushScheduler } from '@roles/collector/trigger/scheduler/candle-flush.scheduler';
import { RefreshUniverseUsecase } from '@roles/collector/usecase/refresh-universe.usecase';
import { SyncStockListUsecase } from '@roles/collector/usecase/sync-stock-list.usecase';
import { EvaluateAlertsUsecase } from '@roles/detector/usecase/evaluate-alerts.usecase';
import {
  AdminJobKind,
  type TriggerJobRequestDto,
  type TriggerJobResponseDto,
} from '@admin/dto/trigger-job.dto';

interface JobBinding {
  readonly owner: WorkerRole;
  // Constructor reference used as the DI token. ModuleRef.get with
  // strict=false walks the full app graph so AdminModule does NOT need
  // to import the role modules — it only needs the class reference as
  // the lookup key.
  readonly token: Type<unknown>;
  readonly invoke: (instance: unknown) => Promise<void>;
}

const JOB_BINDINGS: Record<AdminJobKind, JobBinding> = {
  [AdminJobKind.UniverseRefresh]: {
    owner: 'collector',
    token: RefreshUniverseUsecase,
    invoke: (i) => (i as RefreshUniverseUsecase).execute(),
  },
  [AdminJobKind.CandleFlush]: {
    owner: 'collector',
    token: CandleFlushScheduler,
    // Reuses the shutdown drain — it's idempotent and operator-safe.
    invoke: (i) => (i as CandleFlushScheduler).onApplicationShutdown(),
  },
  [AdminJobKind.StockListSync]: {
    owner: 'collector',
    token: SyncStockListUsecase,
    invoke: async (i) => {
      await (i as SyncStockListUsecase).execute();
    },
  },
  [AdminJobKind.AlertEval]: {
    owner: 'detector',
    token: EvaluateAlertsUsecase,
    invoke: (i) => (i as EvaluateAlertsUsecase).execute(),
  },
};

@Injectable()
export class TriggerAdminJobUsecase {
  private readonly logger = new Logger(TriggerAdminJobUsecase.name);

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    private readonly moduleRef: ModuleRef,
  ) {}

  async execute(input: TriggerJobRequestDto): Promise<TriggerJobResponseDto> {
    const binding = JOB_BINDINGS[input.job];

    if (!this.runtime.roles.includes(binding.owner)) {
      return { triggered: false, detail: `role=${binding.owner} not active in this worker` };
    }

    let instance: unknown;

    try {
      instance = this.moduleRef.get(binding.token, { strict: false });
    } catch {
      return {
        triggered: false,
        detail: `provider ${binding.token.name} not registered — role module unloaded?`,
      };
    }

    try {
      await binding.invoke(instance);

      return { triggered: true, detail: `${input.job} dispatched` };
    } catch (err) {
      this.logger.warn(`job ${input.job} failed: ${err instanceof Error ? err.message : err}`);

      return {
        triggered: false,
        detail: `job dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
