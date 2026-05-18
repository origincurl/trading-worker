import { Inject, Injectable } from '@nestjs/common';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { BUS_STREAMS } from '@shared/bus/bus.token';
import type {
  BusStreams,
  CreateConsumerOptions,
  StreamMessage,
} from '@shared/bus/bus-streams.interface';
import { StreamsConsumerBase } from '@shared/bus/trigger/streams-consumer.base';
import {
  ALERT_RAISED_STREAM,
  type AlertRaisedPayload,
} from '@shared/event/alert-raised.event';
import { IngestAlertRaisedUsecase } from '@roles/notifier/usecase/ingest-alert-raised.usecase';

const CONSUMER_GROUP = 'notifier';

@Injectable()
export class AlertRaisedConsumer extends StreamsConsumerBase<AlertRaisedPayload> {
  constructor(
    @Inject(BUS_STREAMS) streams: BusStreams,
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    private readonly usecase: IngestAlertRaisedUsecase,
  ) {
    super(streams);
  }

  protected options(): CreateConsumerOptions {
    return {
      stream: ALERT_RAISED_STREAM,
      group: CONSUMER_GROUP,
      consumer: this.runtime.workerInstanceId,
      blockMs: 5_000,
      batchSize: 16,
    };
  }

  protected async handle(message: StreamMessage<AlertRaisedPayload>): Promise<void> {
    await this.usecase.execute({
      streamEntryId: message.id,
      payload: message.event.payload,
    });
  }
}
