import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { WsReconnectRequestDto, type WsReconnectResponseDto } from '@admin/dto/ws-reconnect.dto';
import { AdminAuthGuard } from '@admin/guard/admin-auth.guard';
import { TriggerWsReconnectUsecase } from '@admin/usecase/trigger-ws-reconnect.usecase';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/ws')
export class AdminWsController {
  constructor(private readonly usecase: TriggerWsReconnectUsecase) {}

  @Post('reconnect')
  @HttpCode(200)
  async reconnect(@Body() dto: WsReconnectRequestDto): Promise<WsReconnectResponseDto> {
    return this.usecase.execute(dto);
  }
}
