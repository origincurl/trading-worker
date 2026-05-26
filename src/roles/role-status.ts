import type { WorkerRole } from '@config/runtime.config';
import type {
  HeartbeatMetrics,
  RoleMetricSnapshot,
} from '@shared/cache/heartbeat.writer';

// Each role module exposes a status service under its own token so /health
// can aggregate readiness without depending on role internals. Tokens are
// resolved lazily via ModuleRef — absent tokens mean the role module is not
// loaded in this process (ROLES env did not select it).
export interface RoleStatus {
  readonly role: WorkerRole;
  readonly ready: boolean;
  readonly detail?: string;
}

export interface RoleStatusProvider {
  getStatus(): RoleStatus;
}

export interface RoleMetricProvider {
  getRoleMetrics(): RoleMetricSnapshot;
}

export const COLLECTOR_STATUS = Symbol('COLLECTOR_STATUS');
export const CALCULATOR_STATUS = Symbol('CALCULATOR_STATUS');
export const EXECUTOR_STATUS = Symbol('EXECUTOR_STATUS');
export const DETECTOR_STATUS = Symbol('DETECTOR_STATUS');
export const TRACKER_STATUS = Symbol('TRACKER_STATUS');
export const NOTIFIER_STATUS = Symbol('NOTIFIER_STATUS');

export const COLLECTOR_METRICS = Symbol('COLLECTOR_METRICS');
export const CALCULATOR_METRICS = Symbol('CALCULATOR_METRICS');
export const EXECUTOR_METRICS = Symbol('EXECUTOR_METRICS');
export const DETECTOR_METRICS = Symbol('DETECTOR_METRICS');
export const TRACKER_METRICS = Symbol('TRACKER_METRICS');
export const NOTIFIER_METRICS = Symbol('NOTIFIER_METRICS');

export const ROLE_STATUS_TOKENS: Readonly<Record<WorkerRole, symbol>> = {
  collector: COLLECTOR_STATUS,
  calculator: CALCULATOR_STATUS,
  executor: EXECUTOR_STATUS,
  detector: DETECTOR_STATUS,
  tracker: TRACKER_STATUS,
  notifier: NOTIFIER_STATUS,
};

export const ROLE_METRIC_TOKENS: Readonly<Record<WorkerRole, symbol>> = {
  collector: COLLECTOR_METRICS,
  calculator: CALCULATOR_METRICS,
  executor: EXECUTOR_METRICS,
  detector: DETECTOR_METRICS,
  tracker: TRACKER_METRICS,
  notifier: NOTIFIER_METRICS,
};

export function emptyRoleMetrics(role: WorkerRole): {
  role: WorkerRole;
  metrics: HeartbeatMetrics;
} {
  return { role, metrics: {} };
}
