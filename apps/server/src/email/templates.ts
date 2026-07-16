import type { EmailMessage } from './provider';

export type AuthEmailTemplate = 'verify_email' | 'password_reset' | 'password_changed';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function actionUrl(appUrl: string, path: string, token: string): string {
  const url = new URL(path, appUrl.endsWith('/') ? appUrl : `${appUrl}/`);
  url.searchParams.set('token', token);
  return url.toString();
}

function shell(preview: string, heading: string, body: string, button?: { label: string; href: string }): string {
  return `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(preview)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border:1px solid #e4e4e7;border-radius:12px">
<tr><td style="padding:32px"><div style="font-size:20px;font-weight:700;margin-bottom:24px">Echo</div>
<h1 style="font-size:24px;line-height:1.25;margin:0 0 16px">${escapeHtml(heading)}</h1>
<div style="font-size:16px;line-height:1.6;color:#3f3f46">${body}</div>
${button ? `<p style="margin:28px 0"><a href="${escapeHtml(button.href)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:600">${escapeHtml(button.label)}</a></p><p style="font-size:12px;line-height:1.5;color:#71717a;word-break:break-all">${escapeHtml(button.href)}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
}

export function renderAuthEmail(input: {
  template: AuthEmailTemplate;
  name: string;
  email: string;
  token: string | null;
  appUrl: string;
  from: string;
  replyTo?: string;
  idempotencyKey: string;
}): EmailMessage {
  const greeting = `Hi ${escapeHtml(input.name)},`;
  if (input.template === 'verify_email') {
    if (!input.token) throw new Error('Verification email requires an authentication token');
    const url = actionUrl(input.appUrl, '/verify-email', input.token);
    return {
      to: input.email,
      from: input.from,
      replyTo: input.replyTo,
      subject: 'Verify your Echo email address',
      html: shell(
        'Verify your Echo email address',
        'Verify your email address',
        `<p>${greeting}</p><p>Confirm this email address to finish creating your Echo account. This link expires in 24 hours and can only be used once.</p>`,
        { label: 'Verify email', href: url },
      ),
      text: `Hi ${input.name},\n\nConfirm this email address to finish creating your Echo account. This link expires in 24 hours and can only be used once.\n\n${url}\n\nIf you did not create an Echo account, you can ignore this email.`,
      idempotencyKey: input.idempotencyKey,
    };
  }
  if (input.template === 'password_reset') {
    if (!input.token) throw new Error('Password reset email requires an authentication token');
    const url = actionUrl(input.appUrl, '/reset-password', input.token);
    return {
      to: input.email,
      from: input.from,
      replyTo: input.replyTo,
      subject: 'Reset your Echo password',
      html: shell(
        'Reset your Echo password',
        'Reset your password',
        `<p>${greeting}</p><p>Use the link below to choose a new Echo password. It expires in one hour and can only be used once.</p>`,
        { label: 'Reset password', href: url },
      ),
      text: `Hi ${input.name},\n\nUse the link below to choose a new Echo password. It expires in one hour and can only be used once.\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
      idempotencyKey: input.idempotencyKey,
    };
  }
  return {
    to: input.email,
    from: input.from,
    replyTo: input.replyTo,
    subject: 'Your Echo password was changed',
    html: shell(
      'Your Echo password was changed',
      'Your password was changed',
      `<p>${greeting}</p><p>The password for your Echo account was changed. All existing dashboard sessions were signed out.</p><p>If you did not make this change, contact the operator of your Echo server immediately.</p>`,
    ),
    text: `Hi ${input.name},\n\nThe password for your Echo account was changed. All existing dashboard sessions were signed out.\n\nIf you did not make this change, contact the operator of your Echo server immediately.`,
    idempotencyKey: input.idempotencyKey,
  };
}
