import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export enum CredentialTarget {
  KiwoomCollector = 'kiwoom-collector',
  KiwoomExecutor = 'kiwoom-executor',
}

export class TestCredentialsRequestDto {
  @IsEnum(CredentialTarget)
  target!: CredentialTarget;

  @IsOptional()
  @IsInt()
  @Min(1)
  accountId?: number;
}

export interface TestCredentialsResponseDto {
  ok: boolean;
  detail: string;
}
