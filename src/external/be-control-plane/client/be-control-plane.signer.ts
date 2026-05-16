import { createHmac, randomBytes } from 'node:crypto';
import { jcsStringify } from '@common/util/jcs';

export interface SignedRequestHeaders {
  'X-Worker-Id': string;
  'X-Timestamp': string;
  'X-Nonce': string;
  'X-Signature': string;
  'Content-Type': 'application/json';
}

export interface SignedRequest {
  readonly headers: SignedRequestHeaders;
  readonly body: string;
}

export interface BeControlPlaneSignerOptions {
  readonly workerId: string;
  readonly hmacSecret: string;
}

// Signature scheme (must match trading-be verifier byte-for-byte):
//   stringToSign = `${workerId}\n${timestamp}\n${nonce}\n${jcsBody}`
//   signature    = HMAC-SHA256(secret, stringToSign), hex
// JCS gives a stable byte representation of `body`. The newline-delimited
// envelope binds the signature to the workerId/timestamp/nonce headers so
// they can't be re-bound to a different body at verify time.
export class BeControlPlaneSigner {
  constructor(private readonly opts: BeControlPlaneSignerOptions) {
    if (!opts.workerId) throw new Error('BeControlPlaneSigner: workerId required');
    if (!opts.hmacSecret) throw new Error('BeControlPlaneSigner: hmacSecret required');
  }

  sign(body: unknown, now: Date = new Date()): SignedRequest {
    const timestamp = now.toISOString();
    const nonce = randomBytes(16).toString('hex');
    const jcsBody = jcsStringify(body);
    const stringToSign = `${this.opts.workerId}\n${timestamp}\n${nonce}\n${jcsBody}`;

    const signature = createHmac('sha256', this.opts.hmacSecret).update(stringToSign).digest('hex');

    return {
      headers: {
        'X-Worker-Id': this.opts.workerId,
        'X-Timestamp': timestamp,
        'X-Nonce': nonce,
        'X-Signature': signature,
        'Content-Type': 'application/json',
      },
      body: jcsBody,
    };
  }
}
