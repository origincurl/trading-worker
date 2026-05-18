import type { EventChannelSourceType } from '@shared/model/event-channel/event-channel-source-type.enum';
import type { EventChannelModel } from '@shared/model/event-channel/event-channel.model';

export interface EventChannelRepository {
  // Notifier dispatch path. Returns active rows wired to the given
  // source (account_strategy_event / account_risk_event) so callers can
  // fan out to every channel.
  findCandidatesBySourceEvent(
    sourceType: EventChannelSourceType,
    sourceEventId: number,
  ): Promise<EventChannelModel[]>;
}
