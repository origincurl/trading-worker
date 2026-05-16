import type { WorkerEvent } from '@shared/event/worker-event';

export interface StreamMessage<T = unknown> {
  readonly id: string;
  readonly event: WorkerEvent<T>;
}

export type StreamHandler<T = unknown> = (msg: StreamMessage<T>) => Promise<void>;

export interface CreateConsumerOptions {
  readonly stream: string;
  readonly group: string;
  readonly consumer: string;
  readonly blockMs?: number;
  readonly batchSize?: number;
}

export interface BusStreamConsumer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface BusStreams {
  produce<T>(stream: string, event: WorkerEvent<T>): Promise<string>;
  createConsumer<T>(opts: CreateConsumerOptions, handler: StreamHandler<T>): BusStreamConsumer;
}
