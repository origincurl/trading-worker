// All vendor platforms (SMS, TELEGRAM, DISCORD, SLACK, PUSH) currently
// have mock impls only. Per-platform env vars (api keys, webhooks, etc.)
// will be introduced when each platform's real api-client lands.
export interface NotifyConfig {
  // intentionally empty placeholder while platforms are mock-only
  readonly _placeholder?: never;
}

export function loadNotifyConfig(_env: NodeJS.ProcessEnv): NotifyConfig {
  return {};
}

export const NOTIFY_CONFIG = Symbol('NOTIFY_CONFIG');
