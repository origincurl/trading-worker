import { Inject, Injectable } from '@nestjs/common';
import { BUS_QUEUE } from '@shared/bus/bus.token';
import type {
  BusQueue,
  BusQueueJob,
  CreateProcessorOptions,
} from '@shared/bus/bus-queue.interface';
import { BullMqProcessorBase } from '@shared/bus/trigger/bullmq-processor.base';
import {
  SIGNAL_DETECTED_QUEUE,
  type SignalDetectedJobPayload,
} from '@shared/event/signal-detected.event';
import { PlaceOrderUsecase } from '@roles/executor/usecase/place-order.usecase';

const CONCURRENCY = 4;

@Injectable()
export class SignalDetectedConsumer extends BullMqProcessorBase<SignalDetectedJobPayload> {
  constructor(
    @Inject(BUS_QUEUE) queue: BusQueue,
    private readonly placeOrder: PlaceOrderUsecase,
  ) {
    super(queue);
  }

  protected options(): CreateProcessorOptions {
    return {
      queue: SIGNAL_DETECTED_QUEUE,
      concurrency: CONCURRENCY,
    };
  }

  protected async handle(job: BusQueueJob<SignalDetectedJobPayload>): Promise<void> {
    await this.placeOrder.execute(job.data);
  }
}
