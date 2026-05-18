import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationDeliveryEntity } from './notification-delivery.entity';
import type {
  NotificationDeliveryInput,
  NotificationDeliveryRepository,
} from './notification-delivery.repository';

@Injectable()
export class NotificationDeliveryRepositoryImpl implements NotificationDeliveryRepository {
  private readonly logger = new Logger(NotificationDeliveryRepositoryImpl.name);

  constructor(
    @Optional()
    @InjectRepository(NotificationDeliveryEntity)
    private readonly deliveries?: Repository<NotificationDeliveryEntity>,
  ) {}

  async insert(input: NotificationDeliveryInput): Promise<void> {
    if (!this.deliveries) {
      this.logger.debug(
        `persistence disabled — delivery audit skipped (outbox=${input.outboxId} status=${input.status})`,
      );

      return;
    }

    await this.deliveries.save(
      this.deliveries.create({
        outboxId: input.outboxId,
        channelId: input.channelId,
        channelType: input.channelType,
        status: input.status,
        sentAt: input.sentAt,
        responsePayload: input.responsePayload,
      }),
    );
  }
}
