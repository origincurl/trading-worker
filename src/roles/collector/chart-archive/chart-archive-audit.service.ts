import { Injectable, Logger } from '@nestjs/common';
import { ChartArchiveManifestRepository } from './chart-archive-manifest.repository';
import { ChartArchiveS3Service } from './chart-archive-s3.service';
import { ChartArchiveAlertService } from './chart-archive-alert.service';

@Injectable()
export class ChartArchiveAuditService {
  private readonly logger = new Logger(ChartArchiveAuditService.name);

  constructor(
    private readonly manifests: ChartArchiveManifestRepository,
    private readonly s3: ChartArchiveS3Service,
    private readonly alerts: ChartArchiveAlertService,
  ) {}

  async auditReadyManifests(limit = 100): Promise<{ checked: number; mismatched: number }> {
    const rows = await this.manifests.findReadyManifestsForAudit(limit);
    let mismatched = 0;
    for (const row of rows) {
      try {
        await this.s3.verifyRowsObject(row.s3Key, {
          objectChecksum: row.objectChecksum,
          contentChecksum: row.contentChecksum,
        });
      } catch (err) {
        mismatched += 1;
        const reason = `S3 checksum verification failed: ${err instanceof Error ? err.message : String(err)}`;
        await this.manifests.markMismatch({
          manifestId: row.id,
          actor: 'chart-archive-audit',
          reason,
          metadata: {
            provider: row.provider,
            marketEnv: row.marketEnv,
            symbol: row.symbol,
            timeframe: row.timeframe,
            partitionKey: row.partitionKey,
            s3Key: row.s3Key,
          },
        });
        await this.alerts.raise({
          category: 'chart-archive-mismatch',
          severity: 'critical',
          subject: 'Chart archive checksum mismatch',
          message: reason,
          metadata: {
            manifestId: String(row.id),
            symbol: row.symbol,
            timeframe: row.timeframe,
            partitionKey: row.partitionKey,
          },
        });
        this.logger.warn(`chart archive manifest MISMATCH id=${row.id} key=${row.s3Key}: ${reason}`);
      }
    }
    return { checked: rows.length, mismatched };
  }
}
