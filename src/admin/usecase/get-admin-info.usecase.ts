import { Inject, Injectable } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import type { AdminInfoResponseDto } from '@admin/dto/admin-info.response.dto';

@Injectable()
export class GetAdminInfoUsecase {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
  ) {}

  execute(): AdminInfoResponseDto {
    const startedAt = new Date(this.startedAt);
    const shard =
      this.runtime.shardIndex !== undefined && this.runtime.shardCount !== undefined
        ? { index: this.runtime.shardIndex, count: this.runtime.shardCount }
        : undefined;

    return {
      workerInstanceId: this.runtime.workerInstanceId,
      nodeEnv: this.runtime.nodeEnv,
      activeRoles: this.runtime.roles,
      shard,
      kiwoom: {
        marketEnv: this.kiwoom.marketEnv,
        wsHost: this.kiwoom.wsUrl ? hostnameOf(this.kiwoom.wsUrl) : null,
        restHost: this.kiwoom.restUrl ? hostnameOf(this.kiwoom.restUrl) : null,
      },
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      startedAtIso: startedAt.toISOString(),
    };
  }
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
