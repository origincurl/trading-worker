import { Injectable, Logger } from '@nestjs/common';
import { redactPotentialSecrets } from '@common/util/redact.util';

// In-memory cooldown map keyed by credentialId. CredentialSourceService
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

  private readonly cooldownUntil = new Map<number, number>();

  setCooldown(credentialId: number, ms: number, reason: string): void {
    const until = Date.now() + ms;

    this.cooldownUntil.set(credentialId, until);

    const safeReason = redactPotentialSecrets(reason) ?? 'credential failure';

    this.logger.warn(
      `credential id=${credentialId} cooldown ${ms}ms reason="${safeReason}" until=${new Date(until).toISOString()}`,
    );
  }

  isOnCooldown(credentialId: number): boolean {
    const until = this.cooldownUntil.get(credentialId);

    if (until === undefined) return false;

    if (Date.now() < until) return true;

    // Expired — remove so the map doesn't grow unbounded.
    this.cooldownUntil.delete(credentialId);

    return false;
  }

  clear(credentialId: number): void {
    this.cooldownUntil.delete(credentialId);
  }
}
