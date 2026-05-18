import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { NotificationModel } from '@shared/model/notification/notification.model';
import { NotificationEntity } from './notification.entity';
import type {
  CreateNotificationInput,
  NotificationRepository,
} from './notification.repository';

@Injectable()
export class NotificationRepositoryImpl implements NotificationRepository {
  constructor(
    @Optional()
    @InjectRepository(NotificationEntity)
    private readonly repo?: Repository<NotificationEntity>,
  ) {}

  async createNotification(input: CreateNotificationInput): Promise<NotificationModel> {
    if (!this.repo) {
      return Object.assign(new (class {})() as NotificationModel, {
        ...input,
        id: 0,
        readAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const saved = await this.repo.save(this.repo.create({ ...input, readAt: null }));

    return saved.toModel();
  }

  async markRead(id: number, userId: number): Promise<boolean> {
    if (!this.repo) return false;

    // Only flip the timestamp once — re-marking a read notification is a
    // no-op to avoid touching updated_at unnecessarily.
    const result = await this.repo.update(
      { id, userId, readAt: IsNull() },
      { readAt: new Date() },
    );

    return (result.affected ?? 0) > 0;
  }
}
