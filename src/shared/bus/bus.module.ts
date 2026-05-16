import { Global, Module } from '@nestjs/common';
import { BullMqBusQueue } from './bullmq/bullmq-bus-queue';
import { BUS_PUBLISHER, BUS_QUEUE, BUS_STREAMS } from './bus.token';
import { RedisBusPublisher } from './redis/redis-bus-publisher';
import { RedisBusStreams } from './redis/redis-bus-streams';
import { RedisBusSubscriber } from './redis/redis-bus-subscriber';

@Global()
@Module({
  providers: [
    RedisBusPublisher,
    RedisBusSubscriber,
    RedisBusStreams,
    BullMqBusQueue,
    { provide: BUS_PUBLISHER, useExisting: RedisBusPublisher },
    { provide: BUS_STREAMS, useExisting: RedisBusStreams },
    { provide: BUS_QUEUE, useExisting: BullMqBusQueue },
  ],
  exports: [BUS_PUBLISHER, BUS_STREAMS, BUS_QUEUE, RedisBusSubscriber],
})
export class BusModule {}
