import { WorkerRole } from './worker-role.enum';

export class WorkerPolicyModel {
  id!: number;
  role!: WorkerRole;
  key!: string;
  valueJson!: Record<string, unknown>;
  description!: string | null;
  isActive!: boolean;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
}
