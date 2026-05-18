import type { MarketModel } from '@shared/model/market/market.model';

export interface MarketRepository {
  findByCode(code: string): Promise<MarketModel | null>;
  findById(id: number): Promise<MarketModel | null>;
}
