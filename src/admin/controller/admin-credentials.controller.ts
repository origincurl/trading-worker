import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '@admin/guard/admin-auth.guard';
import {
  TestCredentialsRequestDto,
  type TestCredentialsResponseDto,
} from '@admin/dto/test-credentials.dto';
import { TestCredentialsUsecase } from '@admin/usecase/test-credentials.usecase';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/credentials')
export class AdminCredentialsController {
  constructor(private readonly usecase: TestCredentialsUsecase) {}

  @Post('test')
  @HttpCode(200)
  async test(@Body() dto: TestCredentialsRequestDto): Promise<TestCredentialsResponseDto> {
    return this.usecase.execute(dto);
  }
}
