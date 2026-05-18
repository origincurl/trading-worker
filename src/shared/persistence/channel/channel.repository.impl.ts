import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ChannelModel } from '@shared/model/channel/channel.model';
import { ChannelEntity } from './channel.entity';
import type { ChannelRepository } from './channel.repository';

@Injectable()
export class ChannelRepositoryImpl implements ChannelRepository {
  constructor(
    @Optional()
    @InjectRepository(ChannelEntity)
    private readonly repo?: Repository<ChannelEntity>,
  ) {}

  async findById(id: number): Promise<ChannelModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({ where: { id } });

    return row ? row.toModel() : null;
  }

  async findByUserId(userId: number): Promise<ChannelModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({ where: { userId } });

    return rows.map((r) => r.toModel());
  }
}
