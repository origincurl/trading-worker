import { Logger } from '@nestjs/common';
import { NotImplementedError } from '@common/error/domain.error';

// Phase 4: skeleton only. Real Aligo HTTP integration will be added if
// SMS becomes an active channel.
export class AligoApiClient {
  private readonly logger = new Logger(AligoApiClient.name);

  async send(to: string, message: string): Promise<void> {
    void to;

    void message;

    throw new NotImplementedError('AligoApiClient.send not implemented');
  }
}
