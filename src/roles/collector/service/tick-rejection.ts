export const TickRejection = {
  ParseWarning: 'parse-warning',
  MissingRequiredField: 'missing-required-field',
  InvalidPrice: 'invalid-price',
  InvalidVolume: 'invalid-volume',
  StaleTick: 'stale-tick',
} as const;

export type TickRejectionCode = (typeof TickRejection)[keyof typeof TickRejection];
