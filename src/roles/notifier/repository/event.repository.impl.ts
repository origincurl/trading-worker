import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEntity } from './event.entity';
import type { EventRecordInput, EventRepository, RecordedEvent } from './event.repository';

@Injectable()
export class EventRepositoryImpl implements EventRepository {
  private readonly logger = new Logger(EventRepositoryImpl.name);

  constructor(
    @Optional()
    @InjectRepository(EventEntity)
    private readonly events?: Repository<EventEntity>,
  ) {}

  async insertIfAbsent(
    input: EventRecordInput,
  ): Promise<{ event: RecordedEvent; isNew: boolean }> {
    if (!this.events) {
      // Persistence disabled — return a synthetic row so the dispatch
      // pipeline keeps running in dev without Postgres.
      this.logger.debug(
        `persistence disabled — event insert skipped (${input.sourceType}:${input.sourceId}:${input.eventType})`,
      );

      return {
        event: {
          id: '0',
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          eventType: input.eventType,
          level: input.level,
          payload: input.payload,
          occurredAt: input.occurredAt,
        },
        isNew: false,
      };
    }

    const existing = await this.events.findOne({
      where: {
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? undefined,
        eventType: input.eventType,
      },
    });

    if (existing) {
      return { event: this.toModel(existing), isNew: false };
    }

    const saved = await this.events.save(
      this.events.create({
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        accountId: input.accountId,
        accountStrategyEventId: input.accountStrategyEventId,
        accountRiskEventId: input.accountRiskEventId,
        eventType: input.eventType,
        level: input.level,
        payload: input.payload,
        occurredAt: input.occurredAt,
        processedAt: null,
      }),
    );

    return { event: this.toModel(saved), isNew: true };
  }

  async markProcessed(eventId: string, processedAt: Date): Promise<void> {
    if (!this.events) return;

    await this.events.update({ id: eventId }, { processedAt });
  }

  private toModel(entity: EventEntity): RecordedEvent {
    return {
      id: String(entity.id),
      sourceType: entity.sourceType,
      sourceId: entity.sourceId,
      eventType: entity.eventType,
      level: entity.level,
      payload: entity.payload,
      occurredAt: entity.occurredAt,
    };
  }
}
