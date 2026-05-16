// Lease bundle handed out by BE. Architecture §10 mandates memory-only:
// must NEVER reach Redis / Postgres / logs / event payloads.
export interface CredentialLeaseModel {
  readonly leaseId: string;
  readonly vendor: string;
  readonly accountId: string;
  readonly scope: string;
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly issuedAt: string;
}
