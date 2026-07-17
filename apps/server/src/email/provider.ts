import type { Config } from '@/config';

export interface EmailMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ messageId: string }>;
}

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<{ messageId: string }> {
    // This adapter is deliberately useful for local development: the text body
    // includes the action URL, so no external mail account is required.
    console.info(`[email:console] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
    return { messageId: `console:${message.idempotencyKey}` };
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly config: Pick<Config, 'RESEND_API_KEY'>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<{ messageId: string }> {
    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.RESEND_API_KEY}`,
        'content-type': 'application/json',
        'idempotency-key': message.idempotencyKey,
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => null)) as {
      id?: string;
      message?: string;
      error?: { message?: string };
    } | null;
    if (!response.ok || !body?.id) {
      const detail = body?.message ?? body?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`Resend rejected the email: ${detail}`);
    }
    return { messageId: body.id };
  }
}

export function createEmailProvider(config: Config): EmailProvider {
  switch (config.EMAIL_PROVIDER) {
    case 'resend':
      return new ResendEmailProvider(config);
    case 'console':
      return new ConsoleEmailProvider();
  }
}
