import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EventChannelSourceType } from '@shared/model/event-channel/event-channel-source-type.enum';
import type { EventChannelModel } from '@shared/model/event-channel/event-channel.model';
import { EventChannelEntity } from './event-channel.entity';
import type { EventChannelRepository } from './event-channel.repository';

@Injectable()
export class EventChannelRepositoryImpl implements EventChannelRepository {
  constructor(
    @Optional()
    @InjectRepository(EventChannelEntity)
    private readonly repo?: Repository<EventChannelEntity>,
  ) {}

  async findCandidatesBySourceEvent(
    sourceType: EventChannelSourceType,
    sourceEventId: number,
  ): Promise<EventChannelModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({
      where: { sourceType, sourceEventId, isActive: true },
    });

    return rows.map((r) => r.toModel());
  }
}
