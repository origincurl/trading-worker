import { ALERT_RAISED_STREAM, type AlertRaisedPayload } from '@shared/event/alert-raised.event';
import { DECISION_MADE_STREAM, type DecisionMadePayload } from '@shared/event/decision-made.event';
import { ORDER_FAILED_STREAM } from '@shared/event/order-failed.event';
import { ORDER_FILLED_STREAM } from '@shared/event/order-filled.event';
import { ORDER_PLACED_STREAM } from '@shared/event/order-placed.event';

// EventEntity.source_type values mirror BE-side naming. Keep upper-snake;
// notifier writes these straight through.
export type NotifierSourceType = 'ORDER' | 'DECISION' | 'WARNING' | 'SYSTEM';

export type NotifierLevel = 'info' | 'warning' | 'critical';

export interface ResolvedEventType {
  readonly sourceType: NotifierSourceType;
  readonly eventType: string;
  readonly level: NotifierLevel;
}

const SIGNAL_DETECTED_STREAM = 'signal.detected';

// Single source of truth for mapping worker bus stream names →
// EventEntity (source_type, event_type, level). All ingest usecases
// resolve through this so adding a new stream is one edit.
export function resolveEventType(streamName: string, payload: unknown): ResolvedEventType {
  switch (streamName) {
    case ORDER_FILLED_STREAM:
      return { sourceType: 'ORDER', eventType: 'ORDER_FILLED', level: 'info' };
    case ORDER_PLACED_STREAM:
      return { sourceType: 'ORDER', eventType: 'ORDER_PLACED', level: 'info' };
    case ORDER_FAILED_STREAM:
      return { sourceType: 'ORDER', eventType: 'ORDER_FAILED', level: 'warning' };
    case DECISION_MADE_STREAM: {
      const code = (payload as Partial<DecisionMadePayload> | null)?.sourceStrategyEventCode;

      return {
        sourceType: 'DECISION',
        eventType: typeof code === 'string' && code.length > 0 ? code : 'DECISION_MADE',
        level: 'info',
      };
    }
    case ALERT_RAISED_STREAM: {
      const raw = payload as
        | (Partial<AlertRaisedPayload> & { riskCode?: string })
        | null;
      const code =
        typeof raw?.riskCode === 'string' && raw.riskCode.length > 0
          ? raw.riskCode
          : typeof raw?.category === 'string' && raw.category.length > 0
            ? raw.category
            : 'ALERT_RAISED';
      const severity = raw?.severity;
      const level: NotifierLevel =
        severity === 'critical' || severity === 'warning' ? severity : 'info';

      return { sourceType: 'WARNING', eventType: code, level };
    }
    case SIGNAL_DETECTED_STREAM:
      return { sourceType: 'SYSTEM', eventType: 'SIGNAL_DETECTED', level: 'info' };
    default:
      return { sourceType: 'SYSTEM', eventType: streamName, level: 'info' };
  }
}
