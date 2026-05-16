import { IsEnum } from 'class-validator';

export enum AdminJobKind {
  UniverseRefresh = 'universe-refresh',
  CandleFlush = 'candle-flush',
  ChartBackfillPoll = 'chart-backfill-poll',
  AlertEval = 'alert-eval',
}

export class TriggerJobRequestDto {
  @IsEnum(AdminJobKind)
  job!: AdminJobKind;
}

export interface TriggerJobResponseDto {
  triggered: boolean;
  detail: string;
}
