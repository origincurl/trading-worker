export interface EnqueueOptions {
  readonly jobId?: string;
  readonly delayMs?: number;
  readonly attempts?: number;
  readonly backoff?: {
    readonly type: 'fixed' | 'exponential';
    readonly delayMs: number;
  };
}

export interface BusQueueJob<T = unknown> {
  readonly id: string;
  readonly data: T;
  readonly attemptsMade: number;
}

export type QueueHandler<T = unknown> = (job: BusQueueJob<T>) => Promise<void>;

export interface BusQueueProcessor {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CreateProcessorOptions {
  readonly queue: string;
  readonly concurrency?: number;
}

export interface BusQueue {
  enqueue<T>(queue: string, payload: T, opts?: EnqueueOptions): Promise<void>;
  createProcessor<T>(opts: CreateProcessorOptions, handler: QueueHandler<T>): BusQueueProcessor;
}
