// Role-isolated brokerage gateway tokens. The two gateways MUST be backed
// by distinct vendor credentials so collector traffic cannot exhaust the
// executor's rate budget (architecture.md §10). The boot-time check in
// kiwoom.config.ts guarantees the keys differ; this DI split guarantees
// the rate limiter / api client instances differ.
export const COLLECTOR_BROKERAGE_GATEWAY = Symbol('COLLECTOR_BROKERAGE_GATEWAY');
export const EXECUTOR_BROKERAGE_GATEWAY = Symbol('EXECUTOR_BROKERAGE_GATEWAY');

export type BrokerageGatewayProfile = 'collector' | 'executor';
