import { ChannelType } from './channel-type.enum';

export class ChannelModel {
  id!: number;
  userId!: number;
  name!: string;
  channelType!: ChannelType;
  metadata!: Record<string, unknown> | null;
  isActive!: boolean;
  lastTestedAt!: Date | null;
  lastSuccessAt!: Date | null;
  lastFailedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}
