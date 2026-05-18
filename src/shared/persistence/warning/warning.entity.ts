import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RiskType } from '@shared/model/risk/risk-type.enum';
import { WarningLevel } from '@shared/model/warning/warning-level.enum';
import { WarningStatus } from '@shared/model/warning/warning-status.enum';
import { WarningModel } from '@shared/model/warning/warning.model';

@Index('IDX_warning_account_id', ['accountId'])
@Index('IDX_warning_account_risk_id', ['accountRiskId'])
@Index('IDX_warning_risk_id', ['riskId'])
@Index('IDX_warning_stock_id', ['stockId'])
@Index('IDX_warning_warned_at', ['warnedAt'])
@Entity('warnings')
export class WarningEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId!: number;

  @Column({ name: 'account_risk_id', type: 'bigint' })
  accountRiskId!: number;

  @Column({ name: 'risk_id', type: 'bigint' })
  riskId!: number;

  @Column({ name: 'stock_id', type: 'bigint', nullable: true })
  stockId!: number | null;

  @Column({ name: 'risk_type', type: 'enum', enum: RiskType, nullable: true })
  riskType!: RiskType | null;

  @Column({ type: 'enum', enum: WarningLevel })
  level!: WarningLevel;

  @Column({ type: 'enum', enum: WarningStatus })
  status!: WarningStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ name: 'indicator_snapshot', type: 'json', nullable: true })
  indicatorSnapshot!: Record<string, unknown> | null;

  @Column({ name: 'warning_data', type: 'json', nullable: true })
  warningData!: Record<string, unknown> | null;

  @Column({ name: 'warned_at', type: 'timestamp' })
  warnedAt!: Date;

  @Column({ name: 'read_at', type: 'timestamp', nullable: true })
  readAt!: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  toModel(): WarningModel {
    return Object.assign(new WarningModel(), this);
  }
}
