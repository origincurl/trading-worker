import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CollectorDeadLetterPayload } from '@shared/event/collector-dead-letter.event';
import { DeadLetterEntity } from './dead-letter.entity';

export const DEAD_LETTER_REPOSITORY = Symbol('DEAD_LETTER_REPOSITORY');

export interface DeadLetterRepository {
  insert(payload: CollectorDeadLetterPayload): Promise<void>;
}

// TypeORM impl. No-op when persistence is disabled (Phase 1 degraded-boot).
@Injectable()
export class DeadLetterRepositoryImpl implements DeadLetterRepository {
  private readonly logger = new Logger(DeadLetterRepositoryImpl.name);

  constructor(
    @Optional()
    @InjectRepository(DeadLetterEntity)
    private readonly repo?: Repository<DeadLetterEntity>,
  ) {}

  async insert(payload: CollectorDeadLetterPayload): Promise<void> {
    if (!this.repo) {
      this.logger.debug(`persistence disabled — dead-letter row skipped: ${payload.reason}`);

      return;
    }

    await this.repo.save(
      this.repo.create({
        provider: payload.provider,
        marketEnv: payload.marketEnv,
        workerInstanceId: payload.workerInstanceId,
        reason: payload.reason,
        realtimeType: payload.realtimeType,
        symbol: payload.symbol,
        receivedAt: new Date(payload.receivedAt),
        detail: payload.detail,
        parseWarnings: payload.parseWarnings ? [...payload.parseWarnings] : null,
      }),
    );
  }
}
