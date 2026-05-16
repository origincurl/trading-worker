import { Global, Module } from '@nestjs/common';
import { WorkerEventFactory } from './event-factory';

@Global()
@Module({
  providers: [WorkerEventFactory],
  exports: [WorkerEventFactory],
})
export class EventModule {}
