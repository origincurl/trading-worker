import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TriggerJobRequestDto, type TriggerJobResponseDto } from '@admin/dto/trigger-job.dto';
import { AdminAuthGuard } from '@admin/guard/admin-auth.guard';
import { TriggerAdminJobUsecase } from '@admin/usecase/trigger-admin-job.usecase';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/jobs')
export class AdminJobsController {
  constructor(private readonly usecase: TriggerAdminJobUsecase) {}

  @Post('trigger')
  @HttpCode(200)
  async trigger(@Body() dto: TriggerJobRequestDto): Promise<TriggerJobResponseDto> {
    return this.usecase.execute(dto);
  }
}
