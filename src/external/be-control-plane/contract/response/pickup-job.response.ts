export interface PickupJobEntryContract {
  readonly jobId: string;
  readonly payload: unknown;
}

export interface PickupJobResponseContract {
  readonly jobs: ReadonlyArray<PickupJobEntryContract>;
}
