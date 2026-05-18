import { Logger } from '@nestjs/common';
import { Buffer } from 'node:buffer';
import { WebSocket, type RawData } from 'ws';
import { DomainError, NotImplementedError } from '@common/error/domain.error';
import { safeStringify } from '@common/util/safe-stringify';
import type { BrokerageVendorProfile } from '../../brokerage.token';
import type { KiwoomTokenSupplier } from './kiwoom.api-client';

export interface KiwoomWsClientOptions {
  readonly profile: BrokerageVendorProfile;
  readonly wsUrl?: string;
  // Per-connect token resolution. Returns a valid bearer; the gateway
  // performs LOGIN with it post-connect (see kiwoom-brokerage.vendor).
  readonly tokenSupplier: KiwoomTokenSupplier;
  readonly connectTimeoutMs?: number;
  readonly closeTimeoutMs?: number;
  readonly logTruncateChars?: number;
  readonly logFrames?: boolean;
  // Phase 6.8: auto-reconnect with exponential backoff. Set enabled=false
  // to keep the Phase 6 manual behavior (used by tests).
  readonly reconnect?: {
    readonly enabled: boolean;
    readonly initialDelayMs?: number;
    readonly maxDelayMs?: number;
    readonly maxAttempts?: number;
  };
}

export type KiwoomWsMessageHandler = (parsed: unknown, raw: string) => void;
export type KiwoomWsCloseHandler = (code: number, reason: string) => void;
export type KiwoomWsErrorHandler = (err: Error) => void;

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;
const DEFAULT_LOG_TRUNCATE = 1024;

// Minimal Kiwoom WebSocket client. Phase 6 scope: connect → send (LOGIN /
// REG / REMOVE) → observe → disconnect. No auto-reconnect yet — that lands
// in Phase 6.8 along with resubscribe and heartbeat timeout.
//
// Logging: every tx/rx line passes through `safeStringify` (which applies
// redactSecrets) before emission. Tokens never appear in logs.
export class KiwoomWsClient {
  private readonly logger: Logger;

  private readonly url: string | undefined;

  private readonly connectTimeoutMs: number;

  private readonly closeTimeoutMs: number;

  private readonly logTruncateChars: number;

  private readonly logFrames: boolean;

  private socket: WebSocket | null = null;

  private readonly messageHandlers: KiwoomWsMessageHandler[] = [];

  private closeHandler: KiwoomWsCloseHandler | null = null;

  private errorHandler: KiwoomWsErrorHandler | null = null;

  constructor(private readonly opts: KiwoomWsClientOptions) {
    this.logger = new Logger(`KiwoomWsClient[${opts.profile}]`);

    this.url = opts.wsUrl;

    this.connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

    this.closeTimeoutMs = opts.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;

    this.logTruncateChars = opts.logTruncateChars ?? DEFAULT_LOG_TRUNCATE;

    this.logFrames = opts.logFrames ?? false;
  }

  get profile(): BrokerageVendorProfile {
    return this.opts.profile;
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  onMessage(handler: KiwoomWsMessageHandler): () => void {
    this.messageHandlers.push(handler);

    return () => {
      const idx = this.messageHandlers.indexOf(handler);

      if (idx >= 0) this.messageHandlers.splice(idx, 1);
    };
  }

  onClose(handler: KiwoomWsCloseHandler): void {
    this.closeHandler = handler;
  }

  onError(handler: KiwoomWsErrorHandler): void {
    this.errorHandler = handler;
  }

  async connect(): Promise<void> {
    if (!this.url) {
      throw new NotImplementedError('Kiwoom WS URL not configured', {
        profile: this.opts.profile,
      });
    }

    if (this.socket) {
      throw new DomainError('KiwoomWsClient already connected', 'KIWOOM_WS_ALREADY_CONNECTED', {
        profile: this.opts.profile,
      });
    }

    const socket = new WebSocket(this.url);

    this.socket = socket;

    this.logger.log(`ws connecting host=${safeHost(this.url)}`);

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();

        try {
          socket.terminate();
        } catch {
          // ignore
        }

        reject(new Error(`KiwoomWsClient: connect timeout after ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);

      const cleanup = () => {
        clearTimeout(timer);

        socket.off('open', onOpen);

        socket.off('error', onError);
      };

      const onOpen = () => {
        cleanup();

        this.logger.log(`ws open host=${safeHost(this.url!)}`);

        socket.on('message', (data: RawData) => this.handleIncoming(data));

        socket.on('close', (code: number, reason: Buffer) => {
          if (this.socket === socket) this.socket = null;

          const reasonText = reason.toString();

          this.logger.log(`ws close code=${code} reason=${reasonText}`);

          this.closeHandler?.(code, reasonText);
        });

        socket.on('error', (err: Error) => {
          this.logger.error(`ws error ${err.message}`);

          this.errorHandler?.(err);
        });

        resolve();
      };

      const onError = (err: Error) => {
        cleanup();

        this.socket = null;

        reject(err);
      };

      socket.once('open', onOpen);

      socket.once('error', onError);
    });
  }

  async send(message: object): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new DomainError('KiwoomWsClient socket not open', 'KIWOOM_WS_NOT_OPEN', {
        profile: this.opts.profile,
      });
    }

    const payload = JSON.stringify(message);

    this.logFrame('tx', message);

    return new Promise<void>((resolve, reject) => {
      this.socket!.send(payload, (err) => (err ? reject(err) : resolve()));
    });
  }

  async disconnect(code = 1000, reason = 'client-disconnect'): Promise<void> {
    const socket = this.socket;

    this.socket = null;

    if (!socket) return;

    return new Promise<void>((resolve) => {
      const onClose = () => resolve();

      socket.once('close', onClose);

      try {
        socket.close(code, reason);
      } catch {
        resolve();

        return;
      }

      setTimeout(() => {
        try {
          socket.terminate();
        } catch {
          // ignore
        }

        resolve();
      }, this.closeTimeoutMs);
    });
  }

  private handleIncoming(data: RawData): void {
    const raw = rawDataToString(data);
    let parsed: unknown = raw;

    try {
      parsed = JSON.parse(raw);
    } catch {
      // keep raw string
    }

    this.logFrame('rx', parsed);

    for (const handler of this.messageHandlers) {
      try {
        handler(parsed, raw);
      } catch (err) {
        this.logger.warn(`ws onMessage handler threw: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private logFrame(direction: 'tx' | 'rx', payload: unknown): void {
    if (!this.logFrames) return;

    const safe = safeStringify(payload);

    this.logger.log(`ws ${direction} ${this.truncate(safe)}`);
  }

  private truncate(s: string): string {
    if (s.length <= this.logTruncateChars) return s;

    return `${s.slice(0, this.logTruncateChars)}…(+${s.length - this.logTruncateChars} chars)`;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '<invalid-url>';
  }
}

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }

  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }

  return Buffer.from(data as ArrayBuffer).toString('utf8');
}
