import { SettingLevel } from '@shared/model/notification/setting-level.enum';
import { EventChannelSourceType } from './event-channel-source-type.enum';

export class EventChannelModel {
  id!: number;
  ownerUserId!: number;
  sourceType!: EventChannelSourceType;
  sourceEventId!: number;
  channelId!: number;
  minLevel!: SettingLevel;
  templateId!: number | null;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
