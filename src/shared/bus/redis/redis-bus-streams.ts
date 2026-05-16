import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { IntegrationError } from '@common/error/domain.error';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
import type { WorkerEvent } from '@shared/event/worker-event';
import type {
  BusStreamConsumer,
  BusStreams,
  CreateConsumerOptions,
  StreamHandler,
  StreamMessage,
} from '../bus-streams.interface';

const PAYLOAD_FIELD = 'd';

@Injectable()
export class RedisBusStreams implements BusStreams {
  private readonly logger = new Logger(RedisBusStreams.name);

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly client: RedisClientToken) {}

  async produce<T>(stream: string, event: WorkerEvent<T>): Promise<string> {
    if (!this.client) {
      throw new IntegrationError('Redis disabled — cannot produce to stream', {
        stream,
      });
    }

    try {
      const id = await this.client.xadd(stream, '*', PAYLOAD_FIELD, JSON.stringify(event));

      if (!id) {
        throw new IntegrationError('XADD returned null id', { stream });
      }

      return id;
    } catch (err) {
      throw new IntegrationError(`XADD failed on stream ${stream}`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  createConsumer<T>(opts: CreateConsumerOptions, handler: StreamHandler<T>): BusStreamConsumer {
    return new RedisStreamConsumer(this.client, opts, handler, this.logger);
  }
}

class RedisStreamConsumer implements BusStreamConsumer {
  private running = false;

  private loopPromise?: Promise<void>;

  constructor(
    private readonly client: Redis | undefined,
    private readonly opts: CreateConsumerOptions,
    private readonly handler: StreamHandler,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    if (!this.client) {
      throw new IntegrationError('Redis disabled — cannot start stream consumer', {
        stream: this.opts.stream,
      });
    }

    if (this.running) return;

    await this.ensureGroup();

    this.running = true;

    this.loopPromise = this.loop().catch((err) => {
      this.logger.error(`stream consumer loop crashed: ${err}`);
    });
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.loopPromise) {
      await this.loopPromise;

      this.loopPromise = undefined;
    }
  }

  private async ensureGroup(): Promise<void> {
    try {
      await this.client!.xgroup('CREATE', this.opts.stream, this.opts.group, '$', 'MKSTREAM');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // BUSYGROUP = group already exists. Idempotent ensure.
      if (!msg.includes('BUSYGROUP')) {
        throw new IntegrationError(`xgroup create failed`, {
          stream: this.opts.stream,
          group: this.opts.group,
          cause: msg,
        });
      }
    }
  }

  private async loop(): Promise<void> {
    const block = this.opts.blockMs ?? 5000;
    const count = this.opts.batchSize ?? 16;

    while (this.running) {
      try {
        const res = (await this.client!.xreadgroup(
          'GROUP',
          this.opts.group,
          this.opts.consumer,
          'COUNT',
          count,
          'BLOCK',
          block,
          'STREAMS',
          this.opts.stream,
          '>',
        )) as Array<[string, Array<[string, string[]]>]> | null;

        if (!res) continue;

        for (const [, entries] of res) {
          for (const [id, fields] of entries) {
            const message = this.parseEntry<unknown>(id, fields);

            if (!message) {
              await this.client!.xack(this.opts.stream, this.opts.group, id);
              continue;
            }

            try {
              await this.handler(message);

              await this.client!.xack(this.opts.stream, this.opts.group, id);
            } catch (handlerErr) {
              this.logger.error(
                `stream handler failed (stream=${this.opts.stream} id=${id}): ${handlerErr}`,
              );
              // Leave unacked so XPENDING / consumer claim can retry.
            }
          }
        }
      } catch (err) {
        this.logger.error(`xreadgroup error: ${err}`);

        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private parseEntry<T>(id: string, fields: string[]): StreamMessage<T> | null {
    for (let i = 0; i < fields.length; i += 2) {
      if (fields[i] === PAYLOAD_FIELD) {
        try {
          const event = JSON.parse(fields[i + 1]) as WorkerEvent<T>;

          return { id, event };
        } catch {
          this.logger.warn(`stream entry ${id} payload JSON parse failed — acking and dropping`);

          return null;
        }
      }
    }

    this.logger.warn(`stream entry ${id} missing payload field — acking and dropping`);

    return null;
  }
}
