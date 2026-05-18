import { MarketStatus } from './market-status.enum';

export class MarketModel {
  id!: number;
  exchangeId!: number;
  code!: string;
  name!: string;
  country!: string | null;
  currency!: string | null;
  timezone!: string | null;
  isActive!: boolean;
  isTradable!: boolean;
  isOrderable!: boolean;
  openTime!: string | null;
  closeTime!: string | null;
  status!: MarketStatus;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
}
