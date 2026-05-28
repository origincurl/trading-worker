import { Injectable, Logger } from '@nestjs/common';
import { redactPotentialSecrets } from '@common/util/redact.util';

// In-memory cooldown map keyed by (credential kind, credentialId). The
// numeric ids come from different tables (`collector_credentials` and
// `api_credentials`) and may overlap.
//
// CredentialSourceService
// filters out credentials currently on cooldown when selecting; callers
// that observe a vendor failure call `setCooldown` with a reason and
// duration so the same row isn't picked again for a while.
//
// Pure in-memory by design — cooldown state is per-process. Cross-process
// coordination would need redis but we don't need it yet (each worker
// pod sees its own rate-limit / auth failures).
@Injectable()
export class CredentialCooldownService {
  private readonly logger = new Logger(CredentialCooldownService.name);

  private readonly cooldownUntil = new Map<string, number>();

  setCooldown(kind: 'collector' | 'executor', credentialId: number, ms: number, reason: string): void {
    const until = Date.now() + ms;
    const key = cacheKey(kind, credentialId);

    this.cooldownUntil.set(key, until);

    const safeReason = redactPotentialSecrets(reason) ?? 'credential failure';

    this.logger.warn(
      `credential key=${key} cooldown ${ms}ms reason="${safeReason}" until=${new Date(until).toISOString()}`,
    );
  }

  isOnCooldown(kind: 'collector' | 'executor', credentialId: number): boolean {
    const key = cacheKey(kind, credentialId);
    const until = this.cooldownUntil.get(key);

    if (until === undefined) return false;

    if (Date.now() < until) return true;

    // Expired — remove so the map doesn't grow unbounded.
    this.cooldownUntil.delete(key);

    return false;
  }

  clear(kind: 'collector' | 'executor', credentialId: number): void {
    this.cooldownUntil.delete(cacheKey(kind, credentialId));
  }
}

function cacheKey(kind: 'collector' | 'executor', credentialId: number): string {
  return `${kind}:${credentialId}`;
}
