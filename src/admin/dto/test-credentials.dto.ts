import { IsEnum } from 'class-validator';

export enum CredentialTarget {
  KiwoomCollector = 'kiwoom-collector',
  KiwoomExecutor = 'kiwoom-executor',
  BeControlPlane = 'be-control-plane',
}

export class TestCredentialsRequestDto {
  @IsEnum(CredentialTarget)
  target!: CredentialTarget;
}

export interface TestCredentialsResponseDto {
  ok: boolean;
  detail: string;
}
