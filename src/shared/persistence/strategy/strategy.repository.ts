import type { StrategyModel } from '@shared/model/strategy/strategy.model';

export interface StrategyRepository {
  findById(id: number): Promise<StrategyModel | null>;
  findByIds(ids: readonly number[]): Promise<StrategyModel[]>;
}
