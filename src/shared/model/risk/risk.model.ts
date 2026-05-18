import { RiskType } from './risk-type.enum';

export class RiskModel {
  id!: number;
  name!: string;
  description!: string | null;
  riskType!: RiskType;
  ruleJson!: Record<string, unknown>;
  configJson!: Record<string, unknown> | null;
  eventTypes!: string[];
  version!: number;
  createdByUserId!: number | null;
  updatedByUserId!: number | null;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
}
