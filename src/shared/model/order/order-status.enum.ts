export enum OrderStatus {
  Created = 'CREATED',
  Submitting = 'SUBMITTING',
  Requested = 'REQUESTED',
  Accepted = 'ACCEPTED',
  PartiallyFilled = 'PARTIALLY_FILLED',
  Filled = 'FILLED',
  CancelRequested = 'CANCEL_REQUESTED',
  CancelSubmitting = 'CANCEL_SUBMITTING',
  Cancelled = 'CANCELLED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
  Expired = 'EXPIRED',
}
