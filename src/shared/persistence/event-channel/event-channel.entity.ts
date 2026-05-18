import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EventChannelSourceType } from '@shared/model/event-channel/event-channel-source-type.enum';
import { SettingLevel } from '@shared/model/notification/setting-level.enum';
import { EventChannelModel } from '@shared/model/event-channel/event-channel.model';

@Index('IDX_event_channel_owner_user_id', ['ownerUserId'])
@Index('IDX_event_channel_source_event', ['sourceType', 'sourceEventId'])
@Index('IDX_event_channel_channel_id', ['channelId'])
@Index(
  'UQ_event_channel_source_event_channel',
  ['sourceType', 'sourceEventId', 'channelId'],
  { unique: true },
)
@Entity('event_channels')
export class EventChannelEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'owner_user_id', type: 'bigint' })
  ownerUserId!: number;

  @Column({ name: 'source_type', type: 'enum', enum: EventChannelSourceType })
  sourceType!: EventChannelSourceType;

  @Column({ name: 'source_event_id', type: 'bigint' })
  sourceEventId!: number;

  @Column({ name: 'channel_id', type: 'bigint' })
  channelId!: number;

  @Column({ name: 'min_level', type: 'enum', enum: SettingLevel, default: SettingLevel.Off })
  minLevel!: SettingLevel;

  @Column({ name: 'template_id', type: 'bigint', nullable: true })
  templateId!: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  toModel(): EventChannelModel {
    return Object.assign(new EventChannelModel(), this);
  }
}
