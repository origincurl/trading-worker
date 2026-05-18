import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { NotificationTemplateModel } from '@shared/model/notification-template/notification-template.model';
import { NotificationTemplateEntity } from './notification-template.entity';
import type { NotificationTemplateRepository } from './notification-template.repository';

@Injectable()
export class NotificationTemplateRepositoryImpl implements NotificationTemplateRepository {
  constructor(
    @Optional()
    @InjectRepository(NotificationTemplateEntity)
    private readonly repo?: Repository<NotificationTemplateEntity>,
  ) {}

  async findById(id: number): Promise<NotificationTemplateModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({ where: { id } });

    return row ? row.toModel() : null;
  }

  async findActive(): Promise<NotificationTemplateModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({ where: { isActive: true } });

    return rows.map((r) => r.toModel());
  }
}
