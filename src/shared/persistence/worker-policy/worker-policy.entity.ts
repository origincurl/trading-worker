import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WorkerRole } from '@shared/model/worker-policy/worker-role.enum';
import { WorkerPolicyModel } from '@shared/model/worker-policy/worker-policy.model';

@Entity('worker_policies')
@Index('uq_worker_policies_role_key_active', ['role', 'key'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
export class WorkerPolicyEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'enum', enum: WorkerRole })
  role!: WorkerRole;

  @Column({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ name: 'value_json', type: 'json' })
  valueJson!: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  toModel(): WorkerPolicyModel {
    return Object.assign(new WorkerPolicyModel(), this);
  }
}
