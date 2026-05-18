import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RiskType } from '@shared/model/risk/risk-type.enum';
import { WarningLevel } from '@shared/model/warning/warning-level.enum';
import { AccountRiskModel } from '@shared/model/account-risk/account-risk.model';

@Index('IDX_account_risk_account_id', ['accountId'])
@Index('IDX_account_risk_source_risk_id', ['sourceRiskId'])
@Index('IDX_account_risk_notification_template_id', ['notificationTemplateId'])
@Entity('account_risks')
export class AccountRiskEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId!: number;

  @Column({ name: 'source_risk_id', type: 'bigint', nullable: true })
  sourceRiskId!: number | null;

  @Column({ name: 'source_version', type: 'int', nullable: true })
  sourceVersion!: number | null;

  @Column({ name: 'notification_template_id', type: 'bigint', nullable: true })
  notificationTemplateId!: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  name!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'risk_type', type: 'enum', enum: RiskType })
  riskType!: RiskType;

  @Column({ name: 'rule_json', type: 'json' })
  ruleJson!: Record<string, unknown>;

  @Column({ type: 'enum', enum: WarningLevel })
  level!: WarningLevel;

  @Column({ type: 'int', default: 0 })
  priority!: number;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive!: boolean;

  @Column({ name: 'is_notification_enabled', type: 'boolean' })
  isNotificationEnabled!: boolean;

  @Column({ name: 'config_json', type: 'json', nullable: true })
  configJson!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  toModel(): AccountRiskModel {
    return Object.assign(new AccountRiskModel(), this);
  }
}
