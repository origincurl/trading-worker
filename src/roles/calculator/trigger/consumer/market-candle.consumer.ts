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
  MARKET_CANDLE_CLOSED_STREAM,
  type MarketCandleClosedPayload,
} from '@shared/event/market-candle-closed.event';
import { ProcessClosedCandleUsecase } from '@roles/calculator/usecase/process-closed-candle.usecase';

const CONSUMER_GROUP = 'calculator';

@Injectable()
export class MarketCandleConsumer extends StreamsConsumerBase<MarketCandleClosedPayload> {
  constructor(
    @Inject(BUS_STREAMS) streams: BusStreams,
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    private readonly usecase: ProcessClosedCandleUsecase,
  ) {
    super(streams);
  }

  protected options(): CreateConsumerOptions {
    return {
      stream: MARKET_CANDLE_CLOSED_STREAM,
      group: CONSUMER_GROUP,
      // Distinct consumer name per instance so replicas of the same group
      // share workload without re-reading each other's claimed messages.
      consumer: this.runtime.workerInstanceId,
      blockMs: 5_000,
      batchSize: 32,
    };
  }

  protected async handle(message: StreamMessage<MarketCandleClosedPayload>): Promise<void> {
    await this.usecase.execute(message.event.payload);
  }
}
