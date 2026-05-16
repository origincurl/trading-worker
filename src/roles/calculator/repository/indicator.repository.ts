import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { IndicatorUpdatedPayload } from '@shared/event/indicator-updated.event';
import { IndicatorEntity } from './indicator.entity';

export const INDICATOR_REPOSITORY = Symbol('INDICATOR_REPOSITORY');

export interface IndicatorRepository {
  upsert(payload: IndicatorUpdatedPayload): Promise<void>;
}

@Injectable()
export class IndicatorRepositoryImpl implements IndicatorRepository {
  private readonly logger = new Logger(IndicatorRepositoryImpl.name);

  constructor(
    @Optional()
    @InjectRepository(IndicatorEntity)
    private readonly repo?: Repository<IndicatorEntity>,
  ) {}

  async upsert(payload: IndicatorUpdatedPayload): Promise<void> {
    if (!this.repo) {
      this.logger.debug(
        `persistence disabled — indicator write skipped (${payload.symbol}/${payload.indicatorType}${payload.windowSize})`,
      );

      return;
    }

    const existing = await this.repo.findOne({
      where: {
        provider: payload.provider,
        marketEnv: payload.marketEnv,
        symbol: payload.symbol,
        bucketStart: new Date(payload.bucketStart),
        indicatorType: payload.indicatorType,
        windowSize: payload.windowSize,
      },
    });

    await this.repo.save(
      this.repo.create({
        ...(existing ?? {}),
        provider: payload.provider,
        marketEnv: payload.marketEnv,
        symbol: payload.symbol,
        bucketStart: new Date(payload.bucketStart),
        indicatorType: payload.indicatorType,
        windowSize: payload.windowSize,
        value: payload.value,
      }),
    );
  }
}
