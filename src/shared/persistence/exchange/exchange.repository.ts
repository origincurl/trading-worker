import type { ExchangeModel } from '@shared/model/exchange/exchange.model';

export interface ExchangeRepository {
  findByCode(code: string): Promise<ExchangeModel | null>;
  findById(id: number): Promise<ExchangeModel | null>;
}
