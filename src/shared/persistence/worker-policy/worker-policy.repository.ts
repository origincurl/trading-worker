import type { WorkerRole } from '@shared/model/worker-policy/worker-role.enum';
import type { WorkerPolicyModel } from '@shared/model/worker-policy/worker-policy.model';

export interface WorkerPolicyRepository {
  // Replaces BE control-plane findWorkerPolicies(role). Returns rows for
  // the requested role only (active + non-deleted). Caching stays in
  // WorkerPolicyCache — Phase B/C swaps that cache's BE client for this
  // repository.
  findByRole(role: WorkerRole): Promise<WorkerPolicyModel[]>;
}
