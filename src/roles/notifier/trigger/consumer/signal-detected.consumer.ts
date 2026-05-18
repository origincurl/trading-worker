import { Inject, Injectable } from '@nestjs/common';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { BUS_STREAMS } from '@shared/bus/bus.token';
import type {
  BusStreams,
  CreateConsumerOptions,
  StreamMessage,
} from '@shared/bus/bus-streams.interface';
import { StreamsConsumerBase } from '@shared/bus/trigger/streams-consumer.base';
import type { SignalDetectedJobPayload } from '@shared/event/signal-detected.event';
import { IngestSignalDetectedUsecase } from '@roles/notifier/usecase/ingest-signal-detected.usecase';

// `signal.detected` flows to executor as a BullMQ job (queue=signal.detected).
// notifier reads a parallel Streams copy (read-only) — we don't enqueue
// the executor. Phase 8 may switch this to a richer decision-made event.
const SIGNAL_DETECTED_STREAM = 'signal.detected';
const CONSUMER_GROUP = 'notifier';

@Injectable()
export class SignalDetectedConsumer extends StreamsConsumerBase<SignalDetectedJobPayload> {
  constructor(
    @Inject(BUS_STREAMS) streams: BusStreams,
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    private readonly usecase: IngestSignalDetectedUsecase,
  ) {
    super(streams);
  }

  protected options(): CreateConsumerOptions {
    return {
      stream: SIGNAL_DETECTED_STREAM,
      group: CONSUMER_GROUP,
      consumer: this.runtime.workerInstanceId,
      blockMs: 5_000,
      batchSize: 16,
    };
  }

  protected async handle(message: StreamMessage<SignalDetectedJobPayload>): Promise<void> {
    await this.usecase.execute({
      streamEntryId: message.id,
      payload: message.event.payload,
    });
  }
}
