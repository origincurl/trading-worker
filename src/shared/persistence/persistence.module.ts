import { Global, Logger, Module, type DynamicModule } from '@nestjs/common';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { types as pgTypes } from 'pg';
import { type PersistenceConfig } from '@config/persistence.config';
import { AccountCredentialEntity } from './account-credential/account-credential.entity';
import { ACCOUNT_CREDENTIAL_REPOSITORY } from './account-credential/account-credential.token';
import { AccountCredentialRepositoryImpl } from './account-credential/account-credential.repository.impl';
import { AccountRiskEntity } from './account-risk/account-risk.entity';
import { AccountRiskEventEntity } from './account-risk/account-risk-event.entity';
import {
  ACCOUNT_RISK_EVENT_REPOSITORY,
  ACCOUNT_RISK_REPOSITORY,
} from './account-risk/account-risk.token';
import { AccountRiskRepositoryImpl } from './account-risk/account-risk.repository.impl';
import { AccountRiskEventRepositoryImpl } from './account-risk/account-risk-event.repository.impl';
import { AccountStrategyEntity } from './account-strategy/account-strategy.entity';
import { AccountStrategyEventEntity } from './account-strategy/account-strategy-event.entity';
import {
  ACCOUNT_STRATEGY_EVENT_REPOSITORY,
  ACCOUNT_STRATEGY_REPOSITORY,
} from './account-strategy/account-strategy.token';
import { AccountStrategyRepositoryImpl } from './account-strategy/account-strategy.repository.impl';
import { AccountStrategyEventRepositoryImpl } from './account-strategy/account-strategy-event.repository.impl';
import { AccountTraderGrantEntity } from './account-trader-grant/account-trader-grant.entity';
import { ACCOUNT_TRADER_GRANT_REPOSITORY } from './account-trader-grant/account-trader-grant.token';
import { AccountTraderGrantRepositoryImpl } from './account-trader-grant/account-trader-grant.repository.impl';
import { AccountEntity } from './account/account.entity';
import { ACCOUNT_REPOSITORY } from './account/account.token';
import { AccountRepositoryImpl } from './account/account.repository.impl';
import { ApiCredentialEntity } from './api-credential/api-credential.entity';
import { API_CREDENTIAL_REPOSITORY } from './api-credential/api-credential.token';
import { ApiCredentialRepositoryImpl } from './api-credential/api-credential.repository.impl';
import { ChannelEntity } from './channel/channel.entity';
import { CHANNEL_REPOSITORY } from './channel/channel.token';
import { ChannelRepositoryImpl } from './channel/channel.repository.impl';
import { CollectorCredentialEntity } from './collector-credential/collector-credential.entity';
import { COLLECTOR_CREDENTIAL_REPOSITORY } from './collector-credential/collector-credential.token';
import { CollectorCredentialRepositoryImpl } from './collector-credential/collector-credential.repository.impl';
import { DecisionEntity } from './decision/decision.entity';
import { DECISION_REPOSITORY } from './decision/decision.token';
import { DecisionRepositoryImpl } from './decision/decision.repository.impl';
import { EtfEntity } from './etf/etf.entity';
import { ETF_REPOSITORY } from './etf/etf.token';
import { EtfRepositoryImpl } from './etf/etf.repository.impl';
import { EventChannelEntity } from './event-channel/event-channel.entity';
import { EVENT_CHANNEL_REPOSITORY } from './event-channel/event-channel.token';
import { EventChannelRepositoryImpl } from './event-channel/event-channel.repository.impl';
import { ExchangeEntity } from './exchange/exchange.entity';
import { EXCHANGE_REPOSITORY } from './exchange/exchange.token';
import { ExchangeRepositoryImpl } from './exchange/exchange.repository.impl';
import { MarketEntity } from './market/market.entity';
import { MARKET_REPOSITORY } from './market/market.token';
import { MarketRepositoryImpl } from './market/market.repository.impl';
import { NotificationTemplateEntity } from './notification-template/notification-template.entity';
import { NOTIFICATION_TEMPLATE_REPOSITORY } from './notification-template/notification-template.token';
import { NotificationTemplateRepositoryImpl } from './notification-template/notification-template.repository.impl';
import { NotificationEntity } from './notification/notification.entity';
import { NOTIFICATION_REPOSITORY } from './notification/notification.token';
import { NotificationRepositoryImpl } from './notification/notification.repository.impl';
import { OrderEntity } from './order/order.entity';
import { ORDER_REPOSITORY } from './order/order.token';
import { OrderRepositoryImpl } from './order/order.repository.impl';
import { RiskEntity } from './risk/risk.entity';
import { RISK_REPOSITORY } from './risk/risk.token';
import { RiskRepositoryImpl } from './risk/risk.repository.impl';
import { SnakeNamingStrategy } from './snake-naming.strategy';
import { StockEntity } from './stock/stock.entity';
import { STOCK_REPOSITORY } from './stock/stock.token';
import { StockRepositoryImpl } from './stock/stock.repository.impl';
import { StrategyEntity } from './strategy/strategy.entity';
import { STRATEGY_REPOSITORY } from './strategy/strategy.token';
import { StrategyRepositoryImpl } from './strategy/strategy.repository.impl';
import { WarningEntity } from './warning/warning.entity';
import { WARNING_REPOSITORY } from './warning/warning.token';
import { WarningRepositoryImpl } from './warning/warning.repository.impl';
import { WorkerPolicyEntity } from './worker-policy/worker-policy.entity';
import { WORKER_POLICY_REPOSITORY } from './worker-policy/worker-policy.token';
import { WorkerPolicyRepositoryImpl } from './worker-policy/worker-policy.repository.impl';

// Postgres returns bigint (OID 20) as a string by default to preserve
// 64-bit precision. Our row ids stay inside Number.MAX_SAFE_INTEGER, so
// coercing matches the entity typings — same trick as trading-be.
pgTypes.setTypeParser(20, (value) => Number(value));

// Shared entities mirrored from trading-be config tables (Phase A /
// md/new-phase/03-worker-direct-config-tables.md). These rows are read
// (and selectively written: collector-credential status updates, orders
// status transitions, decisions/warnings/notifications inserts) by
// every role module, so the providers below are registered globally to
// avoid each role re-declaring TypeOrmModule.forFeature for them.
//
// Role-local entities (candle, account_balance, position, fill,
// order_attempt, event, notification_outbox, notification_delivery) stay
// in their respective role modules — only BE-shared tables move here.
const SHARED_ENTITIES = [
  StockEntity,
  EtfEntity,
  MarketEntity,
  ExchangeEntity,
  CollectorCredentialEntity,
  AccountEntity,
  AccountCredentialEntity,
  ApiCredentialEntity,
  AccountTraderGrantEntity,
  StrategyEntity,
  AccountStrategyEntity,
  AccountStrategyEventEntity,
  RiskEntity,
  AccountRiskEntity,
  AccountRiskEventEntity,
  EventChannelEntity,
  ChannelEntity,
  NotificationTemplateEntity,
  WorkerPolicyEntity,
  OrderEntity,
  DecisionEntity,
  WarningEntity,
  NotificationEntity,
];

// Each repository binds its symbol token to the @Injectable impl via
// `useClass`. Tokens are re-exported (see exports below) so any module
// can `@Inject(STOCK_REPOSITORY)` etc. without importing PersistenceModule.
const SHARED_REPOSITORY_PROVIDERS = [
  { provide: STOCK_REPOSITORY, useClass: StockRepositoryImpl },
  { provide: ETF_REPOSITORY, useClass: EtfRepositoryImpl },
  { provide: MARKET_REPOSITORY, useClass: MarketRepositoryImpl },
  { provide: EXCHANGE_REPOSITORY, useClass: ExchangeRepositoryImpl },
  { provide: COLLECTOR_CREDENTIAL_REPOSITORY, useClass: CollectorCredentialRepositoryImpl },
  { provide: ACCOUNT_REPOSITORY, useClass: AccountRepositoryImpl },
  { provide: ACCOUNT_CREDENTIAL_REPOSITORY, useClass: AccountCredentialRepositoryImpl },
  { provide: API_CREDENTIAL_REPOSITORY, useClass: ApiCredentialRepositoryImpl },
  { provide: ACCOUNT_TRADER_GRANT_REPOSITORY, useClass: AccountTraderGrantRepositoryImpl },
  { provide: STRATEGY_REPOSITORY, useClass: StrategyRepositoryImpl },
  { provide: ACCOUNT_STRATEGY_REPOSITORY, useClass: AccountStrategyRepositoryImpl },
  { provide: ACCOUNT_STRATEGY_EVENT_REPOSITORY, useClass: AccountStrategyEventRepositoryImpl },
  { provide: RISK_REPOSITORY, useClass: RiskRepositoryImpl },
  { provide: ACCOUNT_RISK_REPOSITORY, useClass: AccountRiskRepositoryImpl },
  { provide: ACCOUNT_RISK_EVENT_REPOSITORY, useClass: AccountRiskEventRepositoryImpl },
  { provide: EVENT_CHANNEL_REPOSITORY, useClass: EventChannelRepositoryImpl },
  { provide: CHANNEL_REPOSITORY, useClass: ChannelRepositoryImpl },
  { provide: NOTIFICATION_TEMPLATE_REPOSITORY, useClass: NotificationTemplateRepositoryImpl },
  { provide: WORKER_POLICY_REPOSITORY, useClass: WorkerPolicyRepositoryImpl },
  { provide: ORDER_REPOSITORY, useClass: OrderRepositoryImpl },
  { provide: DECISION_REPOSITORY, useClass: DecisionRepositoryImpl },
  { provide: WARNING_REPOSITORY, useClass: WarningRepositoryImpl },
  { provide: NOTIFICATION_REPOSITORY, useClass: NotificationRepositoryImpl },
];

const SHARED_REPOSITORY_TOKENS = SHARED_REPOSITORY_PROVIDERS.map((p) => p.provide);

@Global()
@Module({})
export class PersistenceModule {
  static register(config: PersistenceConfig): DynamicModule {
    const logger = new Logger(PersistenceModule.name);

    if (!config.databaseUrl) {
      logger.warn(
        'WORKER_DATABASE_URL not set — PersistenceModule running in disabled mode (no DataSource).',
      );

      // Even without a DataSource we still register the repository
      // providers — each impl is @Optional()-aware and returns
      // empty/no-op results, keeping degraded-boot behaviour consistent
      // with the pre-refactor module (candle/order-attempt patterns).
      return {
        module: PersistenceModule,
        providers: SHARED_REPOSITORY_PROVIDERS,
        exports: SHARED_REPOSITORY_TOKENS,
      };
    }

    const typeormOptions: TypeOrmModuleOptions = {
      type: 'postgres',
      url: config.databaseUrl,
      autoLoadEntities: true,
      synchronize: false,
      namingStrategy: new SnakeNamingStrategy(),
      retryAttempts: 0,
      ssl:
        config.databaseUrl.includes('sslmode=no-verify') ||
        config.databaseUrl.includes('sslmode=require')
          ? { rejectUnauthorized: false }
          : false,
    };

    return {
      module: PersistenceModule,
      imports: [
        TypeOrmModule.forRoot(typeormOptions),
        TypeOrmModule.forFeature(SHARED_ENTITIES),
      ],
      providers: SHARED_REPOSITORY_PROVIDERS,
      exports: [TypeOrmModule, ...SHARED_REPOSITORY_TOKENS],
    };
  }
}
