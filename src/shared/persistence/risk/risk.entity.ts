import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RiskType } from '@shared/model/risk/risk-type.enum';
import { RiskModel } from '@shared/model/risk/risk.model';

@Entity('risks')
export class RiskEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'risk_type', type: 'enum', enum: RiskType })
  riskType!: RiskType;

  @Column({ name: 'rule_json', type: 'json' })
  ruleJson!: Record<string, unknown>;

  @Column({ name: 'config_json', type: 'json', nullable: true })
  configJson!: Record<string, unknown> | null;

  @Column({ name: 'event_types', type: 'json', default: () => "('[]')" })
  eventTypes!: string[];

  @Column({ type: 'int', default: 1 })
  version!: number;

  createdByUserId!: number | null;

  updatedByUserId!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  toModel(): RiskModel {
    return Object.assign(new RiskModel(), this);
  }
}
