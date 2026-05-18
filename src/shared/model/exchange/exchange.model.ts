export class ExchangeModel {
  id!: number;
  code!: string;
  name!: string;
  country!: string | null;
  timezone!: string | null;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
}
