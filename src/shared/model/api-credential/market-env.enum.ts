// Mirrors trading-be MarketEnv (api-credential.entity.ts) — DB enum is
// 'MOCK' / 'PRODUCTION'. Worker-side has a separate lowercase
// 'mock'/'production' literal type used in candle/event payloads; this
// enum is the DB-row representation only.
export enum MarketEnv {
  Mock = 'MOCK',
  Production = 'PRODUCTION',
}

export enum ApiCredentialStatus {
  Unknown = 'UNKNOWN',
  Active = 'ACTIVE',
  CredentialCooldown = 'CREDENTIAL_COOLDOWN',
  Expired = 'EXPIRED',
  Invalid = 'INVALID',
  Suspended = 'SUSPENDED',
  Revoked = 'REVOKED',
  Disabled = 'DISABLED',
}
