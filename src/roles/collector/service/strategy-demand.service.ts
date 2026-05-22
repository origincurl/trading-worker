import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AccountStrategyModel } from '@shared/model/account-strategy/account-strategy.model';
import type { ObservedSymbolModel } from '@shared/model/universe/observed-symbol.model';
import { ACCOUNT_STRATEGY_REPOSITORY } from '@shared/persistence/account-strategy/account-strategy.token';
import type { AccountStrategyRepository } from '@shared/persistence/account-strategy/account-strategy.repository';

const SYMBOL_KEY_PATTERN =
  /^(symbol|symbols|ticker|tickers|code|codes|stockSymbol|stockSymbols|stockCode|stockCodes|target|targets|targetSymbol|targetSymbols|watch|watches|watchSymbol|watchSymbols|watchList|universe|universeSymbol|universeSymbols|tickList|stkCd|stkCds|instrumentCode|instrumentCodes)$/i;
const SYMBOL_VALUE_PATTERN = /^[A-Za-z0-9._-]{1,20}$/;

@Injectable()
export class StrategyDemandService {
  private readonly logger = new Logger(StrategyDemandService.name);

  constructor(
    @Inject(ACCOUNT_STRATEGY_REPOSITORY)
    private readonly strategies: AccountStrategyRepository,
  ) {}

  async activeSymbols(): Promise<ObservedSymbolModel[]> {
    const strategies = await this.strategies.findAllActive();
    const symbols = new Set<string>();

    for (const strategy of strategies) {
      for (const symbol of extractStrategySymbols(strategy)) {
        symbols.add(symbol);
      }
    }

    this.logger.log(
      `strategy demand symbols=${symbols.size} activeStrategies=${strategies.length}`,
    );

    return Array.from(symbols)
      .sort()
      .map((symbol) => ({
        symbol,
        source: 'STRATEGY' as const,
        instrumentType: 'STOCK' as const,
      }));
  }
}

function extractStrategySymbols(strategy: AccountStrategyModel): string[] {
  return normalizeSymbols([
    ...extractSymbolsFromUnknown(strategy.ruleJson),
    ...extractSymbolsFromUnknown(strategy.configJson),
  ]);
}

function extractSymbolsFromUnknown(value: unknown, keyHint: string | null = null): string[] {
  if (typeof value === 'string') {
    return keyHint !== null && SYMBOL_KEY_PATTERN.test(keyHint) ? normalizeSymbols([value]) : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractSymbolsFromUnknown(item, keyHint));
  }

  if (value === null || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    extractSymbolsFromUnknown(child, key),
  );
}

function normalizeSymbols(symbols: readonly string[]): string[] {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => SYMBOL_VALUE_PATTERN.test(symbol)),
    ),
  ).sort();
}
