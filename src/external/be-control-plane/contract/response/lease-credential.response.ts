export interface LeaseCredentialResponseContract {
  readonly leaseId: string;
  readonly vendor: string;
  readonly accountId: string;
  readonly scope: string;
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly issuedAt: string;
}
