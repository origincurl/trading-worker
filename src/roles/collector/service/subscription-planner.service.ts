import { Injectable } from '@nestjs/common';

export interface SubscriptionPlan {
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

// Diff between currently-subscribed symbols and target universe → REG/REMOVE
// plan. Cap-aware splitting (Phase 6.7 deferred; current Kiwoom limit fits
// the bootstrap universe).
@Injectable()
export class SubscriptionPlannerService {
  plan(current: readonly string[], target: readonly string[]): SubscriptionPlan {
    const currentSet = new Set(current);
    const targetSet = new Set(target);

    const add: string[] = [];
    const remove: string[] = [];

    for (const t of targetSet) {
      if (!currentSet.has(t)) add.push(t);
    }

    for (const c of currentSet) {
      if (!targetSet.has(c)) remove.push(c);
    }

    return { add, remove };
  }
}
