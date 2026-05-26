import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import type { OrderFilledPayload } from '@shared/event/order-filled.event';
import { OrderStatus } from '@shared/model/order/order-status.enum';
import { OrderType } from '@shared/model/order/order-type.enum';
import { FillEntity } from '@shared/persistence/fill/fill.entity';
import { OrderFillEntity } from '@shared/persistence/order-fill/order-fill.entity';
import { OrderEntity } from '@shared/persistence/order/order.entity';
import { PositionBookEntity } from '@shared/persistence/position-book/position-book.entity';
import { UnmatchedOrderFillEntity } from '@shared/persistence/unmatched-order-fill/unmatched-order-fill.entity';

export interface IngestExecutionFillResult {
  readonly inserted: boolean;
  readonly orderId: number | null;
  readonly anomaly: string | null;
  readonly externalFillId: string | null;
}

export interface PendingFillOutboxItem {
  readonly id: string;
  readonly externalFillId: string;
  readonly payload: OrderFilledPayload;
  readonly needsLivePublish: boolean;
  readonly needsStreamPublish: boolean;
}

const UNMATCHED_RETRY_DELAY_MS = readPositiveInt(
  process.env.TRACKER_UNMATCHED_FILL_RETRY_DELAY_MS,
  5_000,
);
const UNMATCHED_MAX_ATTEMPTS = readPositiveInt(
  process.env.TRACKER_UNMATCHED_FILL_MAX_ATTEMPTS,
  12,
);
const OUTBOX_MAX_ATTEMPTS = readPositiveInt(
  process.env.TRACKER_FILL_OUTBOX_MAX_ATTEMPTS,
  12,
);
const OUTBOX_CLAIM_TTL_MS = readPositiveInt(
  process.env.TRACKER_FILL_OUTBOX_CLAIM_TTL_MS,
  60_000,
);
const OUTBOX_BASE_BACKOFF_MS = readPositiveInt(
  process.env.TRACKER_FILL_OUTBOX_BASE_BACKOFF_MS,
  5_000,
);
const OUTBOX_MAX_BACKOFF_MS = readPositiveInt(
  process.env.TRACKER_FILL_OUTBOX_MAX_BACKOFF_MS,
  5 * 60_000,
);

interface IngestOptions {
  readonly storeUnmatched?: boolean;
}

@Injectable()
export class ExecutionPersistenceService {
  constructor(private readonly dataSource: DataSource) {}

  async ingestExecutionFill(
    payload: OrderFilledPayload,
    options: IngestOptions = {},
  ): Promise<IngestExecutionFillResult> {
    const storeUnmatched = options.storeUnmatched ?? true;
    const externalFillId = payload.externalFillId ?? buildExternalFillId(payload);

    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(OrderEntity);
      const fillRepo = manager.getRepository(FillEntity);
      const orderFillRepo = manager.getRepository(OrderFillEntity);
      const order = await findLockedOrderForFill(orderRepo, payload);

      if (!order) {
        if (storeUnmatched) {
          await saveUnmatchedFill(manager.getRepository(UnmatchedOrderFillEntity), payload, {
            externalFillId,
            reason: 'order-not-found',
            retryable: true,
            orderId: null,
          });
        }

        return { inserted: false, orderId: null, anomaly: 'order-not-found', externalFillId };
      }

      if (!matchesOrderSide(order.orderType, payload.side)) {
        if (storeUnmatched) {
          await saveUnmatchedFill(manager.getRepository(UnmatchedOrderFillEntity), payload, {
            externalFillId,
            reason: 'side-mismatch',
            retryable: false,
            orderId: order.id,
          });
        }

        return {
          inserted: false,
          orderId: order.id,
          anomaly: 'side-mismatch',
          externalFillId,
        };
      }

      const filledAt = new Date(payload.filledAt);
      const aggregate = buildFillAggregate(order, payload);
      if (!aggregate) {
        if (storeUnmatched) {
          await saveUnmatchedFill(manager.getRepository(UnmatchedOrderFillEntity), payload, {
            externalFillId,
            reason: 'invalid-fill',
            retryable: false,
            orderId: order.id,
          });
        }

        return { inserted: false, orderId: order.id, anomaly: 'invalid-fill', externalFillId };
      }

      const fillInserted = await fillRepo
        .createQueryBuilder()
        .insert()
        .into(FillEntity)
        .values({
          accountId: Number(order.accountId),
          orderId: Number(order.id),
          stockId: Number(order.stockId),
          externalFillId,
          fillType: payload.side === 'buy' ? 'BUY' : 'SELL',
          quantity: scaledToDecimal(decimalToScaled(payload.filledQty, 8), 8),
          price: scaledToDecimal(decimalToScaled(payload.filledPrice, 6), 6),
          amount: scaledToDecimal(
            multiplyScaled(
              decimalToScaled(payload.filledQty, 8),
              8,
              decimalToScaled(payload.filledPrice, 6),
              6,
              6,
            ),
            6,
          ),
          feeAmount: null,
          taxAmount: null,
          netAmount: null,
          isPaper: order.isPaper,
          filledAt,
          rawData: { ...payload },
        } as Record<string, unknown>)
        .orIgnore()
        .execute();

      if ((fillInserted.identifiers?.length ?? 0) === 0) {
        return { inserted: false, orderId: order.id, anomaly: null, externalFillId };
      }
      const fillId = Number(fillInserted.identifiers[0]?.id ?? 0) || null;

      await orderRepo.update(
        { id: order.id },
        {
          ...aggregate.fields,
          rawResponse: {
            ...(order.rawResponse ?? {}),
            lastExecutionFill: payload,
            ...(aggregate.anomaly ? { lastExecutionFillAnomaly: aggregate.anomaly } : {}),
          },
        } as Record<string, unknown>,
      );

      await orderFillRepo
        .createQueryBuilder()
        .insert()
        .into(OrderFillEntity)
        .values({
          provider: payload.provider,
          marketEnv: payload.marketEnv,
          accountId: payload.accountId,
          vendorOrderId: payload.vendorOrderId,
          externalFillId,
          clientOrderId: payload.clientOrderId || null,
          symbol: payload.symbol,
          side: payload.side,
          filledQty: payload.filledQty,
          filledPrice: payload.filledPrice,
          filledAt,
          livePublishedAt: null,
          streamPublishedAt: null,
          publishAttempts: 0,
          publishClaimedAt: null,
          nextPublishAt: null,
          lastPublishError: null,
        } as Record<string, unknown>)
        .orIgnore()
        .execute();

      const positionAnomaly = await applyPositionBookFill(
        manager.getRepository(PositionBookEntity),
        {
          order,
          payload,
          fillId,
          filledAt,
          appliedQty: aggregate.appliedQty,
          appliedAmount: aggregate.appliedAmount,
        },
      );

      if (positionAnomaly) {
        await saveUnmatchedFill(manager.getRepository(UnmatchedOrderFillEntity), payload, {
          externalFillId,
          reason: positionAnomaly,
          retryable: false,
          orderId: order.id,
        });
      }

      return {
        inserted: true,
        orderId: order.id,
        anomaly: aggregate.anomaly ?? positionAnomaly,
        externalFillId,
      };
    });
  }

  async retryUnmatchedFills(limit: number): Promise<{
    readonly attempted: number;
    readonly resolved: number;
    readonly deadLettered: number;
  }> {
    const rows = await this.dataSource.getRepository(UnmatchedOrderFillEntity).find({
      where: { status: 'PENDING' },
      order: { nextRetryAt: 'ASC', createdAt: 'ASC' },
      take: Math.max(0, limit),
    });
    const due = rows.filter((row) => !row.nextRetryAt || row.nextRetryAt <= new Date());
    let resolved = 0;
    let deadLettered = 0;

    for (const row of due) {
      const payload = row.payload as unknown as OrderFilledPayload;
      const outcome = await this.ingestExecutionFill(payload, { storeUnmatched: false });

      if (outcome.inserted || outcome.anomaly === null) {
        await this.markUnmatchedResolved(row.externalFillId, outcome.orderId);
        resolved += 1;
        continue;
      }

      const attempts = row.attempts + 1;
      const shouldDeadLetter =
        attempts >= UNMATCHED_MAX_ATTEMPTS ||
        outcome.anomaly === 'side-mismatch' ||
        outcome.anomaly === 'invalid-fill';

      if (shouldDeadLetter) {
        await this.markUnmatchedDeadLetter(row.externalFillId, attempts, outcome.anomaly);
        deadLettered += 1;
      } else {
        await this.deferUnmatched(row.externalFillId, attempts, outcome.anomaly);
      }
    }

    return { attempted: due.length, resolved, deadLettered };
  }

  async countUnmatched(status: 'PENDING' | 'DEAD_LETTER'): Promise<number> {
    return this.dataSource.getRepository(UnmatchedOrderFillEntity).count({ where: { status } });
  }

  async findPendingOutbox(limit: number): Promise<PendingFillOutboxItem[]> {
    const rows = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OrderFillEntity);
      const now = new Date();
      const claimExpiredBefore = new Date(Date.now() - OUTBOX_CLAIM_TTL_MS);
      const picked = await repo
        .createQueryBuilder('fill')
        .where('(fill.livePublishedAt IS NULL OR fill.streamPublishedAt IS NULL)')
        .andWhere('(fill.nextPublishAt IS NULL OR fill.nextPublishAt <= :now)', { now })
        .andWhere(
          '(fill.publishClaimedAt IS NULL OR fill.publishClaimedAt < :claimExpiredBefore)',
          { claimExpiredBefore },
        )
        .orderBy('fill.createdAt', 'ASC')
        .limit(Math.max(0, limit))
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      if (picked.length > 0) {
        await repo.update(
          picked.map((row) => row.id),
          { publishClaimedAt: now } as Record<string, unknown>,
        );
      }

      return picked;
    });

    return rows.map((row) => ({
      id: row.id,
      externalFillId: row.externalFillId,
      payload: {
        provider: row.provider as OrderFilledPayload['provider'],
        marketEnv: row.marketEnv,
        accountId: row.accountId,
        clientOrderId: row.clientOrderId ?? '',
        vendorOrderId: row.vendorOrderId,
        externalFillId: row.externalFillId,
        symbol: row.symbol,
        side: row.side,
        filledQty: Number(row.filledQty),
        filledPrice: Number(row.filledPrice),
        filledAt: row.filledAt.toISOString(),
      },
      needsLivePublish: row.livePublishedAt === null,
      needsStreamPublish: row.streamPublishedAt === null,
    }));
  }

  async markOutboxPublished(
    externalFillId: string,
    channel: 'live' | 'stream',
  ): Promise<void> {
    const field = channel === 'live' ? 'livePublishedAt' : 'streamPublishedAt';
    await this.dataSource
      .getRepository(OrderFillEntity)
      .createQueryBuilder()
      .update(OrderFillEntity)
      .set({ [field]: new Date(), lastPublishError: null } as Record<string, unknown>)
      .where('external_fill_id = :externalFillId', { externalFillId })
      .execute();
  }

  async recordOutboxPublishFailure(externalFillId: string, error: unknown): Promise<void> {
    const currentAttempts = await this.currentOutboxAttempts(externalFillId);
    const backoff = outboxBackoffMs(currentAttempts + 1);

    await this.dataSource
      .getRepository(OrderFillEntity)
      .createQueryBuilder()
      .update(OrderFillEntity)
      .set({
        publishAttempts: () => 'publish_attempts + 1',
        publishClaimedAt: null,
        nextPublishAt: new Date(Date.now() + backoff),
        lastPublishError: error instanceof Error ? error.message : String(error),
      } as Record<string, unknown>)
      .where('external_fill_id = :externalFillId', { externalFillId })
      .execute();
  }

  async releaseOutboxClaim(externalFillId: string): Promise<void> {
    await this.dataSource.getRepository(OrderFillEntity).update(
      { externalFillId },
      {
        publishClaimedAt: null,
        nextPublishAt: null,
      },
    );
  }

  async countPendingOutbox(): Promise<number> {
    return this.dataSource
      .getRepository(OrderFillEntity)
      .createQueryBuilder('fill')
      .where('fill.livePublishedAt IS NULL OR fill.streamPublishedAt IS NULL')
      .getCount();
  }

  async countOutboxPermanentFailures(): Promise<number> {
    return this.dataSource
      .getRepository(OrderFillEntity)
      .createQueryBuilder('fill')
      .where('(fill.livePublishedAt IS NULL OR fill.streamPublishedAt IS NULL)')
      .andWhere('fill.publishAttempts >= :maxAttempts', { maxAttempts: OUTBOX_MAX_ATTEMPTS })
      .getCount();
  }

  private async currentOutboxAttempts(externalFillId: string): Promise<number> {
    const row = await this.dataSource.getRepository(OrderFillEntity).findOne({
      where: { externalFillId },
      select: { publishAttempts: true },
    });

    return row?.publishAttempts ?? 0;
  }

  private async markUnmatchedResolved(
    externalFillId: string,
    orderId: number | null,
  ): Promise<void> {
    await this.dataSource.getRepository(UnmatchedOrderFillEntity).update(
      { externalFillId },
      {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedOrderId: orderId,
        lastError: null,
      },
    );
  }

  private async markUnmatchedDeadLetter(
    externalFillId: string,
    attempts: number,
    reason: string | null,
  ): Promise<void> {
    await this.dataSource.getRepository(UnmatchedOrderFillEntity).update(
      { externalFillId },
      {
        status: 'DEAD_LETTER',
        attempts,
        nextRetryAt: null,
        lastError: reason,
      },
    );
  }

  private async deferUnmatched(
    externalFillId: string,
    attempts: number,
    reason: string | null,
  ): Promise<void> {
    await this.dataSource.getRepository(UnmatchedOrderFillEntity).update(
      { externalFillId },
      {
        attempts,
        nextRetryAt: new Date(Date.now() + UNMATCHED_RETRY_DELAY_MS),
        lastError: reason,
      },
    );
  }
}

async function findLockedOrderForFill(
  repo: Repository<OrderEntity>,
  payload: OrderFilledPayload,
): Promise<OrderEntity | null> {
  const accountExternalId = payload.accountId.trim();
  const vendorOrderId = payload.vendorOrderId.trim();
  const clientOrderId = payload.clientOrderId.trim();
  const query = repo
    .createQueryBuilder('order')
    .where('order.accountExternalId = :accountExternalId', { accountExternalId })
    .setLock('pessimistic_write');

  if (vendorOrderId) {
    query.andWhere(
      '(order.externalOrderId = :vendorOrderId OR order.brokerOrderId = :vendorOrderId)',
      { vendorOrderId },
    );
  } else if (clientOrderId) {
    query.andWhere('order.clientOrderId = :clientOrderId', { clientOrderId });
  } else {
    return null;
  }

  return query.orderBy('order.id', 'DESC').getOne();
}

function buildFillAggregate(
  order: OrderEntity,
  payload: OrderFilledPayload,
): {
  readonly fields: Record<string, unknown>;
  readonly anomaly: string | null;
  readonly appliedQty: string;
  readonly appliedAmount: string;
} | null {
  const fillQty = decimalToScaled(payload.filledQty, 8);
  const fillPrice = decimalToScaled(payload.filledPrice, 6);

  if (fillQty <= 0n || fillPrice < 0n) {
    return null;
  }

  const orderedQty = maxBigInt(0n, decimalToScaled(order.quantity, 8));
  const previousFilledQty = maxBigInt(0n, decimalToScaled(order.filledQuantity ?? 0, 8));
  const previousFilledAmount = maxBigInt(
    0n,
    decimalToScaled(
      order.filledAmount ??
        multiplyScaled(previousFilledQty, 8, decimalToScaled(order.averageFillPrice ?? 0, 6), 6, 6),
      6,
    ),
  );
  const nextFilledQty = minBigInt(orderedQty, previousFilledQty + fillQty);
  const appliedQty = maxBigInt(0n, nextFilledQty - previousFilledQty);
  const appliedAmount = multiplyScaled(appliedQty, 8, fillPrice, 6, 6);
  const nextFilledAmount = previousFilledAmount + appliedAmount;
  const remainingQty = maxBigInt(0n, orderedQty - nextFilledQty);
  const averageFillPrice =
    nextFilledQty > 0n ? divideScaled(nextFilledAmount, 6, nextFilledQty, 8, 6) : null;
  const filledAt = new Date(payload.filledAt);
  const anomaly = fillAnomaly(order.status, orderedQty, appliedQty);
  const nextStatus = resolveFillStatus(order.status, orderedQty, remainingQty);
  const nextAcceptedAt = anomaly?.startsWith('terminal-fill:')
    ? order.acceptedAt
    : order.acceptedAt ?? filledAt;

  return {
    anomaly,
    fields: {
      status: nextStatus,
      brokerOrderId: order.brokerOrderId ?? payload.vendorOrderId,
      externalOrderId: order.externalOrderId ?? payload.vendorOrderId,
      clientOrderId: order.clientOrderId ?? (payload.clientOrderId || null),
      filledQuantity: scaledToDecimal(nextFilledQty, 8),
      remainingQuantity: scaledToDecimal(remainingQty, 8),
      averageFillPrice:
        averageFillPrice === null ? null : scaledToDecimal(averageFillPrice, 6),
      filledAmount: scaledToDecimal(nextFilledAmount, 6),
      acceptedAt: nextAcceptedAt,
      filledAt: remainingQty <= 0n ? filledAt : order.filledAt,
    },
    appliedQty: scaledToDecimal(appliedQty, 8),
    appliedAmount: scaledToDecimal(appliedAmount, 6),
  };
}

function resolveFillStatus(
  current: OrderStatus,
  orderedQty: bigint,
  remainingQty: bigint,
): OrderStatus {
  if (current === OrderStatus.Cancelled) return OrderStatus.Cancelled;
  if (current === OrderStatus.Rejected) return OrderStatus.Rejected;
  if (current === OrderStatus.Failed) return OrderStatus.Failed;
  if (current === OrderStatus.Expired) return OrderStatus.Expired;
  if (orderedQty <= 0n) return current;
  if (remainingQty <= 0n) return OrderStatus.Filled;
  if (
    current === OrderStatus.CancelRequested ||
    current === OrderStatus.CancelSubmitting
  ) {
    return current;
  }

  return OrderStatus.PartiallyFilled;
}

function fillAnomaly(
  current: OrderStatus,
  orderedQty: bigint,
  appliedQty: bigint,
): string | null {
  if (orderedQty <= 0n) return 'ordered-quantity-zero';
  if (appliedQty <= 0n) return 'fill-clamped';
  if (
    current === OrderStatus.Cancelled ||
    current === OrderStatus.Rejected ||
    current === OrderStatus.Failed ||
    current === OrderStatus.Expired
  ) {
    return `terminal-fill:${current}`;
  }

  return null;
}

function matchesOrderSide(orderType: OrderType, side: OrderFilledPayload['side']): boolean {
  if (side === 'buy') return orderType === OrderType.Buy;
  if (side === 'sell') return orderType === OrderType.Sell;

  return false;
}

function buildExternalFillId(payload: OrderFilledPayload): string {
  return [
    payload.provider,
    payload.marketEnv,
    payload.accountId,
    payload.vendorOrderId,
    payload.filledAt,
    scaledToDecimal(decimalToScaled(payload.filledQty, 8), 8),
    scaledToDecimal(decimalToScaled(payload.filledPrice, 6), 6),
  ].join(':');
}

interface SaveUnmatchedOptions {
  readonly externalFillId: string;
  readonly reason: string;
  readonly retryable: boolean;
  readonly orderId: number | null;
}

async function saveUnmatchedFill(
  repo: Repository<UnmatchedOrderFillEntity>,
  payload: OrderFilledPayload,
  options: SaveUnmatchedOptions,
): Promise<void> {
  await repo
    .createQueryBuilder()
    .insert()
    .into(UnmatchedOrderFillEntity)
    .values({
      externalFillId: options.externalFillId,
      provider: payload.provider,
      marketEnv: payload.marketEnv,
      accountId: payload.accountId,
      vendorOrderId: payload.vendorOrderId || null,
      clientOrderId: payload.clientOrderId || null,
      symbol: payload.symbol,
      reason: options.reason,
      status: options.retryable ? 'PENDING' : 'DEAD_LETTER',
      attempts: 0,
      nextRetryAt: options.retryable ? new Date(Date.now() + UNMATCHED_RETRY_DELAY_MS) : null,
      resolvedOrderId: options.orderId,
      resolvedAt: null,
      lastError: options.reason,
      payload: { ...payload },
    } as Record<string, unknown>)
    .orIgnore()
    .execute();
}

interface ApplyPositionBookFillInput {
  readonly order: OrderEntity;
  readonly payload: OrderFilledPayload;
  readonly fillId: number | null;
  readonly filledAt: Date;
  readonly appliedQty: string;
  readonly appliedAmount: string;
}

async function applyPositionBookFill(
  repo: Repository<PositionBookEntity>,
  input: ApplyPositionBookFillInput,
): Promise<string | null> {
  const order = input.order;
  const sourceType: 'STRATEGY' | 'MANUAL' = order.accountStrategyId ? 'STRATEGY' : 'MANUAL';
  const accountStockLockKey = ['position-book', order.accountId, order.stockId, 'all'].join(':');
  const lockKey = [
    'position-book',
    order.accountId,
    order.stockId,
    sourceType,
    sourceType === 'STRATEGY' ? order.accountStrategyId : 'account',
  ].join(':');

  await repo.query('SELECT pg_advisory_xact_lock(hashtext($1))', [accountStockLockKey]);
  await repo.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

  const existing =
    sourceType === 'STRATEGY'
      ? await repo.findOne({
          where: {
            accountId: order.accountId,
            stockId: order.stockId,
            sourceType,
            accountStrategyId: order.accountStrategyId,
          } as Record<string, unknown>,
        })
      : await findManualPositionBook(repo, {
          accountId: order.accountId,
          stockId: order.stockId,
          requestedByUserId: order.requestedByUserId,
          side: input.payload.side,
        });
  if (!existing && input.payload.side === 'sell') {
    return 'position-book-missing-sell';
  }

  const currentQty = decimalToScaled(existing?.quantity ?? 0, 8);
  const currentCost = decimalToScaled(existing?.costAmount ?? 0, 6);
  const fillQty = decimalToScaled(input.appliedQty, 8);
  const fillAmount = decimalToScaled(input.appliedAmount, 6);
  const nextQty =
    input.payload.side === 'buy'
      ? currentQty + fillQty
      : maxBigInt(0n, currentQty - fillQty);
  const nextCost =
    input.payload.side === 'buy'
      ? currentCost + fillAmount
      : nextQty === 0n
        ? 0n
        : maxBigInt(0n, currentCost - multiplyScaled(fillQty, 8, decimalToScaled(existing?.averagePrice ?? 0, 6), 6, 6));
  const nextAverage = nextQty > 0n ? divideScaled(nextCost, 6, nextQty, 8, 6) : 0n;

  if (existing) {
    await repo.update(
      { id: existing.id },
      {
        quantity: scaledToDecimal(nextQty, 8),
        averagePrice: scaledToDecimal(nextAverage, 6),
        costAmount: scaledToDecimal(nextCost, 6),
        lastFillId: input.fillId,
        lastFilledAt: input.filledAt,
      } as Record<string, unknown>,
    );

    return null;
  }

  await repo.insert({
    accountId: order.accountId,
    stockId: order.stockId,
    sourceType,
    accountStrategyId: order.accountStrategyId,
    strategyId: order.strategyId,
    requestedByUserId: order.requestedByUserId,
    quantity: scaledToDecimal(nextQty, 8),
    averagePrice: scaledToDecimal(nextAverage, 6),
    costAmount: scaledToDecimal(nextCost, 6),
    realizedAmount: '0',
    lastFillId: input.fillId,
    lastFilledAt: input.filledAt,
  } as Record<string, unknown>);

  return null;
}

async function findManualPositionBook(
  repo: Repository<PositionBookEntity>,
  input: {
    accountId: number;
    stockId: number;
    requestedByUserId: number | null;
    side: 'buy' | 'sell';
  },
): Promise<PositionBookEntity | null> {
  if (input.requestedByUserId !== null) {
    const userBook = await repo.findOne({
      where: {
        accountId: input.accountId,
        stockId: input.stockId,
        sourceType: 'MANUAL',
        requestedByUserId: input.requestedByUserId,
      } as Record<string, unknown>,
    });
    if (userBook) return userBook;
  }

  if (input.side === 'sell') {
    return await repo.findOne({
      where: {
        accountId: input.accountId,
        stockId: input.stockId,
        sourceType: 'MANUAL',
        requestedByUserId: null,
      } as Record<string, unknown>,
    });
  }

  return null;
}

function decimalToScaled(value: string | number | null | undefined | bigint, scale: number): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;
  const raw = String(value).trim();
  if (!raw) return 0n;
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const scaled = `${whole || '0'}${fraction.padEnd(scale, '0').slice(0, scale)}`;
  const parsed = BigInt(scaled || '0');

  return negative ? -parsed : parsed;
}

function scaledToDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const unsigned = negative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const whole = unsigned / divisor;
  const fraction = (unsigned % divisor).toString().padStart(scale, '0').replace(/0+$/, '');
  const body = fraction ? `${whole}.${fraction}` : whole.toString();

  return negative ? `-${body}` : body;
}

function multiplyScaled(
  left: bigint,
  leftScale: number,
  right: bigint,
  rightScale: number,
  outputScale: number,
): bigint {
  const numerator = left * right * 10n ** BigInt(outputScale);
  const denominator = 10n ** BigInt(leftScale + rightScale);

  return numerator / denominator;
}

function divideScaled(
  numerator: bigint,
  numeratorScale: number,
  denominator: bigint,
  denominatorScale: number,
  outputScale: number,
): bigint {
  if (denominator === 0n) return 0n;

  return (numerator * 10n ** BigInt(denominatorScale + outputScale)) /
    (denominator * 10n ** BigInt(numeratorScale));
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left <= right ? left : right;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left >= right ? left : right;
}

function outboxBackoffMs(attempts: number): number {
  const exponent = Math.min(Math.max(0, attempts - 1), 6);
  const delay = OUTBOX_BASE_BACKOFF_MS * 2 ** exponent;

  return Math.min(delay, OUTBOX_MAX_BACKOFF_MS);
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
