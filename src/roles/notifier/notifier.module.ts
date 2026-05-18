import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotifyModule } from '@external/notify/notify.module';
import { NOTIFIER_STATUS } from '@roles/role-status';
import { EventEntity } from './repository/event.entity';
import { EVENT_REPOSITORY } from './repository/event.repository';
import { EventRepositoryImpl } from './repository/event.repository.impl';
import { NotificationDeliveryEntity } from './repository/notification-delivery.entity';
import { NOTIFICATION_DELIVERY_REPOSITORY } from './repository/notification-delivery.repository';
import { NotificationDeliveryRepositoryImpl } from './repository/notification-delivery.repository.impl';
import { NotificationOutboxEntity } from './repository/notification-outbox.entity';
import { NOTIFICATION_OUTBOX_REPOSITORY } from './repository/notification-outbox.repository';
import { NotificationOutboxRepositoryImpl } from './repository/notification-outbox.repository.impl';
import { EventChannelResolverService } from './service/event-channel-resolver.service';
import { EventRecordService } from './service/event-record.service';
import { NotificationDispatchService } from './service/notification-dispatch.service';
import { NotificationFormatterService } from './service/notification-formatter.service';
import { NotifierStatusService } from './service/notifier-status.service';
import { AlertRaisedConsumer } from './trigger/consumer/alert-raised.consumer';
import { DecisionMadeConsumer } from './trigger/consumer/decision-made.consumer';
import { OrderFailedConsumer } from './trigger/consumer/order-failed.consumer';
import { OrderFilledConsumer } from './trigger/consumer/order-filled.consumer';
import { OrderPlacedConsumer } from './trigger/consumer/order-placed.consumer';
import { SignalDetectedConsumer } from './trigger/consumer/signal-detected.consumer';
import { HeartbeatScheduler } from './trigger/scheduler/heartbeat.scheduler';
import { NotificationOutboxScheduler } from './trigger/scheduler/notification-outbox.scheduler';
import { DispatchNotificationOutboxUsecase } from './usecase/dispatch-notification-outbox.usecase';
import { HeartbeatUsecase } from './usecase/heartbeat.usecase';
import { IngestAlertRaisedUsecase } from './usecase/ingest-alert-raised.usecase';
import { IngestDecisionMadeUsecase } from './usecase/ingest-decision-made.usecase';
import { IngestOrderFailedUsecase } from './usecase/ingest-order-failed.usecase';
import { IngestOrderFilledUsecase } from './usecase/ingest-order-filled.usecase';
import { IngestOrderPlacedUsecase } from './usecase/ingest-order-placed.usecase';
import { IngestSignalDetectedUsecase } from './usecase/ingest-signal-detected.usecase';

// Vendor-agnostic — no BrokerageModule import. Reuses NotifyModule's
// NOTIFY_GATEWAY for channel dispatch and shared PersistenceModule
// repositories for event-channel + internal-PK lookups (Phase D).
// ScheduleModule.forRoot() lives in AppModule (single root) so @Interval
// handlers don't double-fire when multiple role modules load.
@Module({
  imports: [
    NotifyModule,
    TypeOrmModule.forFeature([EventEntity, NotificationOutboxEntity, NotificationDeliveryEntity]),
  ],
  providers: [
    NotifierStatusService,
    EventRecordService,
    EventChannelResolverService,
    NotificationFormatterService,
    NotificationDispatchService,
    EventRepositoryImpl,
    { provide: EVENT_REPOSITORY, useExisting: EventRepositoryImpl },
    NotificationOutboxRepositoryImpl,
    { provide: NOTIFICATION_OUTBOX_REPOSITORY, useExisting: NotificationOutboxRepositoryImpl },
    NotificationDeliveryRepositoryImpl,
    { provide: NOTIFICATION_DELIVERY_REPOSITORY, useExisting: NotificationDeliveryRepositoryImpl },
    IngestOrderFilledUsecase,
    IngestAlertRaisedUsecase,
    IngestSignalDetectedUsecase,
    IngestDecisionMadeUsecase,
    IngestOrderPlacedUsecase,
    IngestOrderFailedUsecase,
    DispatchNotificationOutboxUsecase,
    HeartbeatUsecase,
    OrderFilledConsumer,
    AlertRaisedConsumer,
    SignalDetectedConsumer,
    DecisionMadeConsumer,
    OrderPlacedConsumer,
    OrderFailedConsumer,
    NotificationOutboxScheduler,
    HeartbeatScheduler,
    { provide: NOTIFIER_STATUS, useExisting: NotifierStatusService },
  ],
  exports: [NOTIFIER_STATUS],
})
export class NotifierModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotifierModule.name);

  onApplicationBootstrap(): void {
    this.logger.log('notifier role active');
  }
}
