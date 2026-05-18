export const NOTIFY_VENDOR = Symbol('NOTIFY_VENDOR');

// Backwards alias for callers that haven't been retired yet. Remove after
// all references migrate.
export const NOTIFY_GATEWAY = NOTIFY_VENDOR;

export type NotifyChannelType = 'sms' | 'telegram' | 'discord' | 'slack' | 'push';
