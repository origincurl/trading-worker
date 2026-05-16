import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '@admin/guard/admin-auth.guard';
import type { AdminInfoResponseDto } from '@admin/dto/admin-info.response.dto';
import { GetAdminInfoUsecase } from '@admin/usecase/get-admin-info.usecase';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminInfoController {
  constructor(private readonly usecase: GetAdminInfoUsecase) {}

  @Get('info')
  info(): AdminInfoResponseDto {
    return this.usecase.execute();
  }
}
