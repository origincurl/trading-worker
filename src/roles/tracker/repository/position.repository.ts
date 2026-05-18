import type { TrackerPositionModel } from './position.model';

export const POSITION_REPOSITORY = Symbol('POSITION_REPOSITORY');

export interface UpsertPositionInput {
  readonly accountExternalId: string;
  readonly brokerage: string;
  readonly marketEnv: 'mock' | 'production';
  readonly symbol: string;
  readonly quantity: number;
  readonly lockedQuantity: number | null;
  readonly averagePrice: number;
  readonly syncedAt: Date;
}

export interface PositionRepository {
  upsertMany(inputs: readonly UpsertPositionInput[]): Promise<TrackerPositionModel[]>;
  findByAccount(
    accountExternalId: string,
    brokerage: string,
    marketEnv: 'mock' | 'production',
  ): Promise<TrackerPositionModel[]>;
}
