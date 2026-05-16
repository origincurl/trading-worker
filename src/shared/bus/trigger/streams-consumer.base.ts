import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type {
  BusStreamConsumer,
  BusStreams,
  CreateConsumerOptions,
  StreamMessage,
} from '../bus-streams.interface';

@Injectable()
export abstract class StreamsConsumerBase<T = unknown>
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  protected readonly logger = new Logger(this.constructor.name);

  private consumer?: BusStreamConsumer;

  constructor(protected readonly streams: BusStreams) {}

  protected abstract options(): CreateConsumerOptions;

  protected abstract handle(message: StreamMessage<T>): Promise<void>;

  async onApplicationBootstrap(): Promise<void> {
    const opts = this.options();

    this.consumer = this.streams.createConsumer<T>(opts, (msg) => this.handle(msg));

    // Bound start() — ioredis queues commands while it reconnects, so a
    // downed Redis means xgroup hangs forever and blocks app boot.
    // Phase 2 health check uses the same trick for ping.
    const startTimeoutMs = 2_000;
    const start = this.consumer.start();
    const timeout = new Promise<'TIMEOUT'>((resolve) =>
      setTimeout(() => resolve('TIMEOUT'), startTimeoutMs),
    );

    try {
      const result = await Promise.race([start.then(() => 'OK'), timeout]);

      if (result === 'TIMEOUT') {
        this.logger.warn(
          `stream consumer start timed out after ${startTimeoutMs}ms (${opts.stream}) — degraded boot, will retry on first Redis activity`,
        );
      } else {
        this.logger.log(`stream consumer started: ${opts.stream} (group=${opts.group})`);
      }
    } catch (err) {
      this.logger.warn(
        `stream consumer failed to start (${opts.stream}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.stop();
  }
}
