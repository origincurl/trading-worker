export class StockModel {
  id!: number;
  marketId!: number;
  symbol!: string;
  name!: string;
  englishName!: string | null;
  sector!: string | null;
  industry!: string | null;
  currency!: string | null;
  isActive!: boolean;
  isTradable!: boolean;
  isObserved!: boolean;
  metadata!: Record<string, unknown> | null;
  listedAt!: Date | null;
  delistedAt!: Date | null;
  lastSyncedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
}
