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
  ORDER_PLACED_STREAM,
  type OrderPlacedPayload,
} from '@shared/event/order-placed.event';
import { IngestOrderPlacedUsecase } from '@roles/notifier/usecase/ingest-order-placed.usecase';

const CONSUMER_GROUP = 'notifier';

@Injectable()
export class OrderPlacedConsumer extends StreamsConsumerBase<OrderPlacedPayload> {
  constructor(
    @Inject(BUS_STREAMS) streams: BusStreams,
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    private readonly usecase: IngestOrderPlacedUsecase,
  ) {
    super(streams);
  }

  protected options(): CreateConsumerOptions {
    return {
      stream: ORDER_PLACED_STREAM,
      group: CONSUMER_GROUP,
      consumer: this.runtime.workerInstanceId,
      blockMs: 5_000,
      batchSize: 16,
    };
  }

  protected async handle(message: StreamMessage<OrderPlacedPayload>): Promise<void> {
    await this.usecase.execute({
      streamEntryId: message.id,
      payload: message.event.payload,
    });
  }
}
