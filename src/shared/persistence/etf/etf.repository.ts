import type { EtfModel } from '@shared/model/etf/etf.model';

export interface EtfRepository {
  findObservedEtfs(): Promise<EtfModel[]>;
  findBySymbol(symbol: string): Promise<EtfModel | null>;
}
