import { Logger, ValidationPipe, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { config as loadDotenv } from 'dotenv';
import 'reflect-metadata';
import { AppModule } from './app.module';
import { AllExceptionFilter } from './common/filter/all-exception.filter';
import { validateEnv } from './config/config.module';
import { NodeEnv } from './config/runtime.config';

const VALID_LOG_LEVELS: readonly LogLevel[] = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'];

function resolveLogLevels(env: NodeJS.ProcessEnv): LogLevel[] | undefined {
  const raw = env.LOG_LEVEL?.trim();

  if (!raw) return undefined;

  const requested = raw.split(',').map((s) => s.trim().toLowerCase());
  const valid = requested.filter((l): l is LogLevel => VALID_LOG_LEVELS.includes(l as LogLevel));

  return valid.length > 0 ? valid : undefined;
}

async function bootstrap() {
  loadDotenv({ path: '.env.local', override: false });

  loadDotenv();

  const logger = new Logger('Bootstrap');

  const validated = validateEnv(process.env);

  logger.log(
    `Booting worker instance=${validated.runtime.workerInstanceId} env=${validated.runtime.nodeEnv} roles=[${validated.runtime.roles.join(',')}]`,
  );

  const logLevels = resolveLogLevels(process.env) ?? ['log', 'warn', 'error', 'fatal'];

  const app = await NestFactory.create(AppModule.register(validated), {
    bufferLogs: false,
    logger: logLevels,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionFilter());

  if (validated.runtime.nodeEnv !== NodeEnv.Production) {
    const swagger = new DocumentBuilder()
      .setTitle('trading-worker')
      .setDescription('Internal-only worker ops API')
      .setVersion('0.0.1')
      .build();

    const document = SwaggerModule.createDocument(app, swagger);

    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(validated.runtime.port);

  logger.log(`Worker listening on :${validated.runtime.port}`);
}

bootstrap().catch((err) => {
  // Do not pass err object directly — env validation errors may include
  // secret-adjacent context. The class-validator messages above already
  // describe what is wrong without leaking values.

  console.error('Worker boot failed:', err instanceof Error ? err.message : err);

  process.exit(1);
});
