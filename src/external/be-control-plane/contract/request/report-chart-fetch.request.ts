export interface ReportChartFetchRequestContract {
  readonly jobId: string;
  readonly status: 'ok' | 'failed';
  readonly rowsFetched: number;
  readonly errorMessage?: string;
}
