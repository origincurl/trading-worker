import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Brokerage,
} from '@shared/model/account/brokerage.enum';
import { MarketEnv } from '@shared/model/api-credential/market-env.enum';
import { ACCOUNT_REPOSITORY } from '@shared/persistence/account/account.token';
import type { AccountRepository } from '@shared/persistence/account/account.repository';
import {
  ACCOUNT_RISK_REPOSITORY,
  ACCOUNT_RISK_EVENT_REPOSITORY,
} from '@shared/persistence/account-risk/account-risk.token';
import type { AccountRiskRepository } from '@shared/persistence/account-risk/account-risk.repository';
import type { AccountRiskEventRepository } from '@shared/persistence/account-risk/account-risk-event.repository';
import {
  ACCOUNT_STRATEGY_REPOSITORY,
  ACCOUNT_STRATEGY_EVENT_REPOSITORY,
} from '@shared/persistence/account-strategy/account-strategy.token';
import type { AccountStrategyRepository } from '@shared/persistence/account-strategy/account-strategy.repository';
import type { AccountStrategyEventRepository } from '@shared/persistence/account-strategy/account-strategy-event.repository';
import {
  EVENT_REPOSITORY,
  type EventRecordInput,
  type EventRepository,
  type RecordedEvent,
} from '@roles/notifier/repository/event.repository';

// Resolves external identifiers (accountExternalId, broker order id,
// strategy/risk event code) to internal PKs and writes the `events` row.
//
// Sub-id resolution (Phase D follow-up):
//   - For a given accountId, an account may own multiple active strategies
//     (or risks). Each strategy has its own set of account_strategy_events.
//     We resolve by scanning all active account_strategies for the account,
//     then asking each one for a matching event_type via
//     AccountStrategyEventRepository.findCandidate(accountStrategyId, code).
//     First match wins.
//   - If sourceStrategyId is provided on the payload we narrow the scan to
//     the strategies that reference it as source_strategy_id (otherwise we
//     check all of the account's active strategies). This handles the case
//     where two different strategies emit the same event_type code.
//   - Anything we can't resolve is left null on the events row. The audit
//     row is still inserted; the event-channel resolver short-circuits when
//     sourceEventId<=0 so no outbox row fans out until resolution succeeds.
@Injectable()
export class EventRecordService {
  private readonly logger = new Logger(EventRecordService.name);

  constructor(
    @Inject(EVENT_REPOSITORY) private readonly repo: EventRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accountRepo: AccountRepository,
    @Inject(ACCOUNT_STRATEGY_REPOSITORY)
    private readonly strategyRepo: AccountStrategyRepository,
    @Inject(ACCOUNT_STRATEGY_EVENT_REPOSITORY)
    private readonly strategyEventRepo: AccountStrategyEventRepository,
    @Inject(ACCOUNT_RISK_REPOSITORY)
    private readonly riskRepo: AccountRiskRepository,
    @Inject(ACCOUNT_RISK_EVENT_REPOSITORY)
    private readonly riskEventRepo: AccountRiskEventRepository,
  ) {}

  async record(input: {
    sourceType: string;
    sourceId: string | null;
    eventType: string;
    level: string;
    payload: Record<string, unknown>;
    occurredAt: Date;
    // Optional hints — when provided we resolve to internal PKs before insert.
    accountExternalIdHint?: string | null;
    brokerageHint?: Brokerage | null;
    marketEnvHint?: MarketEnv | null;
    sourceStrategyEventCode?: string | null;
    sourceStrategyId?: number | null;
    sourceRiskEventCode?: string | null;
    sourceRiskId?: number | null;
  }): Promise<{ event: RecordedEvent; isNew: boolean }> {
    const accountId = await this.resolveAccountId(
      input.brokerageHint ?? null,
      input.marketEnvHint ?? null,
      input.accountExternalIdHint ?? null,
    );

    const accountStrategyEventId =
      accountId !== null && input.sourceStrategyEventCode
        ? await this.resolveStrategyEventId(
            accountId,
            input.sourceStrategyEventCode,
            input.sourceStrategyId ?? null,
          )
        : null;

    const accountRiskEventId =
      accountId !== null && input.sourceRiskEventCode
        ? await this.resolveRiskEventId(
            accountId,
            input.sourceRiskEventCode,
            input.sourceRiskId ?? null,
          )
        : null;

    const record: EventRecordInput = {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      accountId: accountId !== null ? String(accountId) : null,
      accountStrategyEventId:
        accountStrategyEventId !== null ? String(accountStrategyEventId) : null,
      accountRiskEventId: accountRiskEventId !== null ? String(accountRiskEventId) : null,
      eventType: input.eventType,
      level: input.level,
      payload: input.payload,
      occurredAt: input.occurredAt,
    };

    return this.repo.insertIfAbsent(record);
  }

  async markProcessed(eventId: string, processedAt: Date): Promise<void> {
    await this.repo.markProcessed(eventId, processedAt);
  }

  private async resolveAccountId(
    brokerage: Brokerage | null,
    marketEnv: MarketEnv | null,
    accountExternalId: string | null,
  ): Promise<number | null> {
    if (!brokerage || !marketEnv || !accountExternalId) return null;

    try {
      const account = await this.accountRepo.findByExternalKey(
        brokerage,
        marketEnv,
        accountExternalId,
      );

      return account?.id ?? null;
    } catch (err) {
      this.logger.warn(
        `account lookup failed (${brokerage}/${marketEnv}/${accountExternalId}): ${err instanceof Error ? err.message : err}`,
      );

      return null;
    }
  }

  private async resolveStrategyEventId(
    accountId: number,
    eventTypeCode: string,
    sourceStrategyId: number | null,
  ): Promise<number | null> {
    let strategies;

    try {
      strategies = await this.strategyRepo.findActiveByAccountId(accountId);
    } catch (err) {
      this.logger.warn(
        `account_strategies lookup failed (accountId=${accountId}): ${err instanceof Error ? err.message : err}`,
      );

      return null;
    }

    const filtered =
      sourceStrategyId !== null
        ? strategies.filter((s) => s.sourceStrategyId === sourceStrategyId)
        : strategies;

    for (const strategy of filtered) {
      try {
        const match = await this.strategyEventRepo.findCandidate(strategy.id, eventTypeCode);

        if (match && match.isEnabled) return match.id;
      } catch (err) {
        this.logger.warn(
          `account_strategy_event lookup failed (asid=${strategy.id} code=${eventTypeCode}): ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return null;
  }

  private async resolveRiskEventId(
    accountId: number,
    eventTypeCode: string,
    sourceRiskId: number | null,
  ): Promise<number | null> {
    let risks;

    try {
      risks = await this.riskRepo.findActiveByAccountId(accountId);
    } catch (err) {
      this.logger.warn(
        `account_risks lookup failed (accountId=${accountId}): ${err instanceof Error ? err.message : err}`,
      );

      return null;
    }

    const filtered =
      sourceRiskId !== null
        ? risks.filter((r) => r.sourceRiskId === sourceRiskId)
        : risks;

    for (const risk of filtered) {
      try {
        const match = await this.riskEventRepo.findCandidate(risk.id, eventTypeCode);

        if (match && match.isEnabled) return match.id;
      } catch (err) {
        this.logger.warn(
          `account_risk_event lookup failed (arid=${risk.id} code=${eventTypeCode}): ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return null;
  }
}
