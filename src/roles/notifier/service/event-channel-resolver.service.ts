import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotifyChannelType } from '@external/notify/notify.token';
import { CHANNEL_REPOSITORY } from '@shared/persistence/channel/channel.token';
import type { ChannelRepository } from '@shared/persistence/channel/channel.repository';
import { EVENT_CHANNEL_REPOSITORY } from '@shared/persistence/event-channel/event-channel.token';
import type { EventChannelRepository } from '@shared/persistence/event-channel/event-channel.repository';
import { ChannelType } from '@shared/model/channel/channel-type.enum';
import { EventChannelSourceType } from '@shared/model/event-channel/event-channel-source-type.enum';
import type { SettingLevel } from '@shared/model/notification/setting-level.enum';

// Enriched candidate returned by the resolver — joins event_channels +
// channels so notifier ingest paths can fan out to the outbox without
// re-querying. Mirrors the surface area of the old
// `EventChannelCandidateModel` so existing callers transition cleanly.
export interface EventChannelCandidate {
  readonly eventChannelId: number;
  readonly channelId: number;
  readonly channelType: NotifyChannelType;
  readonly channelConfig: Record<string, unknown>;
  readonly level: SettingLevel;
  readonly templateId: number | null;
}

// Phase D: DB-backed event_channels lookup. BE control-plane is no longer
// in the path — notifier reads `event_channels` directly and joins
// `channels` for the channel-side delivery type/metadata. Non-success
// degrades to empty so a transient DB hiccup doesn't drop the outbox row
// (event row is already persisted; later reprocess re-resolves).
@Injectable()
export class EventChannelResolverService {
  private readonly logger = new Logger(EventChannelResolverService.name);

  constructor(
    @Inject(EVENT_CHANNEL_REPOSITORY) private readonly repo: EventChannelRepository,
    @Inject(CHANNEL_REPOSITORY) private readonly channelRepo: ChannelRepository,
  ) {}

  async resolve(sourceType: string, sourceEventId: number): Promise<EventChannelCandidate[]> {
    const enumType = this.toSourceTypeEnum(sourceType);

    if (enumType === null || sourceEventId <= 0) {
      // sourceEventId=0 sentinel from ingest paths that don't yet resolve
      // the internal PK. Skip — no candidates rather than full-table scan.
      return [];
    }

    let candidates;

    try {
      candidates = await this.repo.findCandidatesBySourceEvent(enumType, sourceEventId);
    } catch (err) {
      this.logger.warn(
        `event-channel lookup threw — degrading to no candidates: ${err instanceof Error ? err.message : err}`,
      );

      return [];
    }

    const enriched: EventChannelCandidate[] = [];

    for (const candidate of candidates) {
      const channel = await this.channelRepo.findById(candidate.channelId);

      if (!channel || !channel.isActive) continue;

      const notifyType = this.toNotifyChannelType(channel.channelType);

      if (notifyType === null) continue;

      enriched.push({
        eventChannelId: candidate.id,
        channelId: candidate.channelId,
        channelType: notifyType,
        channelConfig: channel.metadata ?? {},
        level: candidate.minLevel,
        templateId: candidate.templateId,
      });
    }

    return enriched;
  }

  private toSourceTypeEnum(sourceType: string): EventChannelSourceType | null {
    switch (sourceType) {
      case 'account_strategy_event':
      case EventChannelSourceType.AccountStrategyEvent:
        return EventChannelSourceType.AccountStrategyEvent;
      case 'account_risk_event':
      case EventChannelSourceType.AccountRiskEvent:
        return EventChannelSourceType.AccountRiskEvent;
      default:
        return null;
    }
  }

  // Maps DB-side ChannelType enum to the notify vendor's lowercase dispatch
  // keys. Supported platforms: SMS, TELEGRAM, DISCORD, SLACK, PUSH (mock
  // impls — real api-clients land per platform later).
  private toNotifyChannelType(type: ChannelType): NotifyChannelType | null {
    switch (type) {
      case ChannelType.Sms:
        return 'sms';
      case ChannelType.Telegram:
        return 'telegram';
      case ChannelType.Discord:
        return 'discord';
      case ChannelType.Slack:
        return 'slack';
      case ChannelType.Push:
        return 'push';
      default:
        return null;
    }
  }
}
