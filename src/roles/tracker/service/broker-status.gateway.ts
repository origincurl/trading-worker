import { Injectable } from '@nestjs/common';

export const BROKER_STATUS_GATEWAY = Symbol('BROKER_STATUS_GATEWAY');

export interface BrokerOpenOrder {
  readonly accountExternalId: string;
  readonly vendorOrderId: string;
  readonly symbol: string | null;
  readonly status: string;
  readonly remainingQty: string | null;
}

export interface BrokerOrderStatus {
  readonly vendorOrderId: string;
  readonly status: string;
  readonly filledQty: string | null;
  readonly remainingQty: string | null;
}

export interface BrokerStatusGateway {
  listOpenOrders(accountId: number, accountExternalId: string): Promise<BrokerOpenOrder[]>;
  getOrderStatus(
    accountId: number,
    accountExternalId: string,
    vendorOrderId: string,
  ): Promise<BrokerOrderStatus | null>;
}

@Injectable()
export class NoopBrokerStatusGateway implements BrokerStatusGateway {
  async listOpenOrders(): Promise<BrokerOpenOrder[]> {
    return [];
  }

  async getOrderStatus(): Promise<BrokerOrderStatus | null> {
    return null;
  }
}
