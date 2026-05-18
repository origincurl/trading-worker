import { Global, Module } from '@nestjs/common';
import { WorkerPolicyCache } from './worker-policy.cache';

// Global so role modules (collector, tracker, ...) can @Inject the cache
// without each adding it to their imports list. Persistence (which owns
// WORKER_POLICY_REPOSITORY) is already global so no explicit import.
@Global()
@Module({
  providers: [WorkerPolicyCache],
  exports: [WorkerPolicyCache],
})
export class PolicyModule {}
