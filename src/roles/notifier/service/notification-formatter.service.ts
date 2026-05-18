import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_TEMPLATE_REPOSITORY } from '@shared/persistence/notification-template/notification-template.token';
import type { NotificationTemplateRepository } from '@shared/persistence/notification-template/notification-template.repository';
import type { EventChannelCandidate } from './event-channel-resolver.service';
import type { RecordedEvent } from '@roles/notifier/repository/event.repository';

export interface FormattedNotification {
  readonly title: string;
  readonly body: string;
}

// Minimal `{{var}}` template engine. Supports dot-paths into the event
// payload (`{{order.symbol}}`) and top-level event metadata
// (`{{eventType}}`, `{{level}}`). Templates come from the
// notification_templates table when `templateId` is set on the candidate;
// otherwise we fall back to a generic one-liner so operators get
// something useful even before they configure per-event templates.
@Injectable()
export class NotificationFormatterService {
  private readonly logger = new Logger(NotificationFormatterService.name);

  constructor(
    @Inject(NOTIFICATION_TEMPLATE_REPOSITORY)
    private readonly templates: NotificationTemplateRepository,
  ) {}

  async format(
    event: RecordedEvent,
    payload: Record<string, unknown>,
    candidate: EventChannelCandidate,
  ): Promise<FormattedNotification> {
    const ctx = this.buildContext(event, payload);

    let titleTemplate: string | null = null;
    let bodyTemplate: string | null = null;

    if (candidate.templateId !== null) {
      try {
        const tpl = await this.templates.findById(candidate.templateId);

        if (tpl && tpl.isActive) {
          titleTemplate = tpl.titleTemplate;
          bodyTemplate = tpl.bodyTemplate;
        }
      } catch (err) {
        this.logger.warn(
          `template lookup failed templateId=${candidate.templateId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const title = titleTemplate
      ? this.render(titleTemplate, ctx)
      : `[${event.level.toUpperCase()}] ${event.eventType}`;

    const body = bodyTemplate ? this.render(bodyTemplate, ctx) : this.defaultBody(event);

    return { title, body };
  }

  private buildContext(
    event: RecordedEvent,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      eventType: event.eventType,
      level: event.level,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      occurredAt: event.occurredAt.toISOString(),
      ...payload,
    };
  }

  private defaultBody(event: RecordedEvent): string {
    try {
      return `${event.eventType} @ ${event.occurredAt.toISOString()}\n${JSON.stringify(
        event.payload,
        null,
        2,
      )}`;
    } catch {
      return `${event.eventType} @ ${event.occurredAt.toISOString()}`;
    }
  }

  private render(template: string, ctx: Record<string, unknown>): string {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
      const value = this.lookup(ctx, path);

      if (value === undefined || value === null) return '';

      if (typeof value === 'object') return JSON.stringify(value);

      return String(value);
    });
  }

  private lookup(ctx: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc === null || acc === undefined) return undefined;

      if (typeof acc !== 'object') return undefined;

      return (acc as Record<string, unknown>)[key];
    }, ctx);
  }
}
