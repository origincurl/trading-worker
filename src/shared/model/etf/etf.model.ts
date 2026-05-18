export class EtfModel {
  id!: number;
  marketId!: number;
  symbol!: string;
  isinSymbol!: string | null;
  name!: string;
  englishName!: string | null;
  trackingIndex!: string | null;
  issuer!: string | null;
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
