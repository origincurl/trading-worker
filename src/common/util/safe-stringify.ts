import { redactSecrets } from './redact-secrets';

export function safeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet();

  const replacer = (_key: string, val: unknown) => {
    if (typeof val === 'bigint') return val.toString();

    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }

    if (val instanceof Error) {
      return { name: val.name, message: val.message, stack: val.stack };
    }

    return val;
  };

  try {
    return JSON.stringify(redactSecrets(value), replacer, space);
  } catch {
    return String(value);
  }
}
