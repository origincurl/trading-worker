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
  ORDER_FAILED_STREAM,
  type OrderFailedPayload,
} from '@shared/event/order-failed.event';
import { IngestOrderFailedUsecase } from '@roles/notifier/usecase/ingest-order-failed.usecase';

const CONSUMER_GROUP = 'notifier';

@Injectable()
export class OrderFailedConsumer extends StreamsConsumerBase<OrderFailedPayload> {
  constructor(
    @Inject(BUS_STREAMS) streams: BusStreams,
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    private readonly usecase: IngestOrderFailedUsecase,
  ) {
    super(streams);
  }

  protected options(): CreateConsumerOptions {
    return {
      stream: ORDER_FAILED_STREAM,
      group: CONSUMER_GROUP,
      consumer: this.runtime.workerInstanceId,
      blockMs: 5_000,
      batchSize: 16,
    };
  }

  protected async handle(message: StreamMessage<OrderFailedPayload>): Promise<void> {
    await this.usecase.execute({
      streamEntryId: message.id,
      payload: message.event.payload,
    });
  }
}
