import { IsEnum } from 'class-validator';

export enum WsReconnectProfile {
  Collector = 'collector',
  Executor = 'executor',
}

export class WsReconnectRequestDto {
  @IsEnum(WsReconnectProfile)
  profile!: WsReconnectProfile;
}

export interface WsReconnectResponseDto {
  triggered: boolean;
  detail: string;
}
