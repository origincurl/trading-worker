const SAFE_SEGMENT_RE = /[^A-Za-z0-9._:-]/g;

export const HELD_POSITION_DEMAND_TTL_SEC = 180;
export const HELD_POSITION_DEMAND_HINT_CHANNEL = 'universe:refresh:hint';

export function heldPositionDemandLeaseKey(input: {
  marketEnv: 'mock' | 'production';
  accountExternalId: string;
  symbol: string;
}): string {
  return [
    'market',
    'demand',
    'position',
    'lease',
    input.marketEnv,
    sanitizeSegment(input.accountExternalId),
    sanitizeSegment(input.symbol),
  ].join(':');
}

export function heldPositionDemandAccountPattern(input: {
  marketEnv: 'mock' | 'production';
  accountExternalId: string;
}): string {
  return [
    'market',
    'demand',
    'position',
    'lease',
    input.marketEnv,
    sanitizeSegment(input.accountExternalId),
    '*',
  ].join(':');
}

export function heldPositionDemandMarketPattern(marketEnv: 'mock' | 'production'): string {
  return ['market', 'demand', 'position', 'lease', marketEnv, '*', '*'].join(':');
}

export function symbolFromHeldPositionDemandLeaseKey(key: string): string | null {
  const parts = key.split(':');
  if (parts.length !== 7) return null;
  if (parts[0] !== 'market' || parts[1] !== 'demand' || parts[2] !== 'position') return null;
  if (parts[3] !== 'lease') return null;
  const symbol = parts[6]?.trim().toUpperCase();
  return symbol ? symbol : null;
}

function sanitizeSegment(value: string): string {
  const sanitized = value.trim().toUpperCase().replace(SAFE_SEGMENT_RE, '_');
  if (!sanitized) return 'UNKNOWN';
  return sanitized;
}
