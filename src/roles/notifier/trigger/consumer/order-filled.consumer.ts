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
  ORDER_FILLED_STREAM,
  type OrderFilledPayload,
} from '@shared/event/order-filled.event';
import { IngestOrderFilledUsecase } from '@roles/notifier/usecase/ingest-order-filled.usecase';

// notifier consumer-group is distinct from any future BE consumer-group
// on the same stream so deliveries aren't stolen.
const CONSUMER_GROUP = 'notifier';

@Injectable()
export class OrderFilledConsumer extends StreamsConsumerBase<OrderFilledPayload> {
  constructor(
    @Inject(BUS_STREAMS) streams: BusStreams,
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    private readonly usecase: IngestOrderFilledUsecase,
  ) {
    super(streams);
  }

  protected options(): CreateConsumerOptions {
    return {
      stream: ORDER_FILLED_STREAM,
      group: CONSUMER_GROUP,
      consumer: this.runtime.workerInstanceId,
      blockMs: 5_000,
      batchSize: 16,
    };
  }

  protected async handle(message: StreamMessage<OrderFilledPayload>): Promise<void> {
    await this.usecase.execute({
      streamEntryId: message.id,
      payload: message.event.payload,
    });
  }
}
