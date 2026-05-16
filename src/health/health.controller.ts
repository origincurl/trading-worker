import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  HealthResponseDto,
  LiveResponseDto,
  ReadyResponseDto,
} from './dto/health.response.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly service: HealthService) {}

  @Get('live')
  live(): LiveResponseDto {
    return this.service.live();
  }

  @Get('ready')
  ready(): Promise<ReadyResponseDto> {
    return this.service.ready();
  }

  @Get('health')
  health(): HealthResponseDto {
    return this.service.health();
  }
}
