import type { WorkerEvent } from '@shared/event/worker-event';

export interface BusPublisher {
  publish<T>(channel: string, event: WorkerEvent<T>): Promise<void>;
}

export type PubsubMessageHandler<T = unknown> = (
  event: WorkerEvent<T>,
  rawChannel: string,
) => Promise<void> | void;

export interface BusSubscriber {
  subscribe<T>(channel: string, handler: PubsubMessageHandler<T>): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
}
