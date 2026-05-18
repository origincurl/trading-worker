import type { RiskModel } from '@shared/model/risk/risk.model';

export interface RiskRepository {
  findById(id: number): Promise<RiskModel | null>;
  findByIds(ids: readonly number[]): Promise<RiskModel[]>;
}
