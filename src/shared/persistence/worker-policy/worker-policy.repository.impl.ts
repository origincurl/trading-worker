import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { WorkerRole } from '@shared/model/worker-policy/worker-role.enum';
import type { WorkerPolicyModel } from '@shared/model/worker-policy/worker-policy.model';
import { WorkerPolicyEntity } from './worker-policy.entity';
import type { WorkerPolicyRepository } from './worker-policy.repository';

@Injectable()
export class WorkerPolicyRepositoryImpl implements WorkerPolicyRepository {
  constructor(
    @Optional()
    @InjectRepository(WorkerPolicyEntity)
    private readonly repo?: Repository<WorkerPolicyEntity>,
  ) {}

  async findByRole(role: WorkerRole): Promise<WorkerPolicyModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({
      where: { role, isActive: true, deletedAt: IsNull() },
    });

    return rows.map((r) => r.toModel());
  }
}
