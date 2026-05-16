import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ADMIN_CONFIG, type AdminConfig } from '@config/admin.config';

// Bearer token gate for every /admin/* endpoint. ADMIN_TOKEN unset →
// total refusal so production deployments don't accidentally expose
// admin surface area when the env var is missing.
@Injectable()
export class AdminAuthGuard implements CanActivate {
  private readonly logger = new Logger(AdminAuthGuard.name);

  private warned = false;

  constructor(@Inject(ADMIN_CONFIG) private readonly config: AdminConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.token) {
      if (!this.warned) {
        this.warned = true;

        this.logger.warn('ADMIN_TOKEN unset — /admin/* refuses all requests');
      }

      throw new UnauthorizedException('admin disabled');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers['authorization'];

    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer');
    }

    const supplied = auth.slice('Bearer '.length).trim();

    if (supplied !== this.config.token) {
      throw new UnauthorizedException('invalid token');
    }

    return true;
  }
}
