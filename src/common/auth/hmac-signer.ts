import { createHmac, timingSafeEqual } from 'node:crypto';
import { jcsStringify } from '../util/jcs';

export interface HmacSignedRequest {
  readonly bodyCanonical: string;
  readonly signature: string;
}

export class HmacSigner {
  constructor(private readonly secret: string) {
    if (!secret || secret.length === 0) {
      throw new Error('HmacSigner requires a non-empty secret');
    }
  }

  sign(payload: unknown): HmacSignedRequest {
    const bodyCanonical = jcsStringify(payload);
    const signature = createHmac('sha256', this.secret).update(bodyCanonical).digest('hex');

    return { bodyCanonical, signature };
  }

  verify(payload: unknown, signatureHex: string): boolean {
    const { signature } = this.sign(payload);

    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(signatureHex, 'hex');

    if (a.length !== b.length) return false;

    return timingSafeEqual(a, b);
  }
}
