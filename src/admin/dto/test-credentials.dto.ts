import { IsEnum } from 'class-validator';

export enum CredentialTarget {
  KiwoomCollector = 'kiwoom-collector',
  KiwoomExecutor = 'kiwoom-executor',
}

export class TestCredentialsRequestDto {
  @IsEnum(CredentialTarget)
  target!: CredentialTarget;
}

export interface TestCredentialsResponseDto {
  ok: boolean;
  detail: string;
}
