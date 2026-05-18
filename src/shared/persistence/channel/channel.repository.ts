import type { ChannelModel } from '@shared/model/channel/channel.model';

export interface ChannelRepository {
  findById(id: number): Promise<ChannelModel | null>;
  findByUserId(userId: number): Promise<ChannelModel[]>;
}
