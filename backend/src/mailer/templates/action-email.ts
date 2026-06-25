// Shared renderer for transactional "do this one action" emails (verify email,
// reset password). Both produce the same branded card with a single CTA button,
// so the scaffold + HTML-escaping live here once and the per-email templates
// just supply copy.

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

export type ActionEmailInput = {
  subject: string;
  heading: string; // card title, e.g. "Confirm your email"
  name: string; // recipient's name (blank → "there")
  intro: string; // sentence(s) under the greeting, plain text
  buttonLabel: string; // CTA label
  url: string; // CTA target (also shown as a copy-paste fallback)
  footer: string; // expiry + "ignore this" note, plain text
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderActionEmail(input: ActionEmailInput): RenderedEmail {
  const name = input.name?.trim() || "there";
  const safeName = escapeHtml(name);
  const safeHeading = escapeHtml(input.heading);
  const safeIntro = escapeHtml(input.intro);
  const safeUrl = escapeHtml(input.url);
  const safeFooter = escapeHtml(input.footer);
  const safeButton = escapeHtml(input.buttonLabel);

  const text = [`Hi ${name},`, "", input.intro, "", input.url, "", input.footer].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2533;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6fb;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(16,24,40,0.08);">
            <tr>
              <td>
                <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#1f2533;">${safeHeading}</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475467;">Hi ${safeName}, ${safeIntro}</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                  <tr>
                    <td style="border-radius:8px;background:#5a5ae2;">
                      <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${safeButton}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#667085;">Or paste this link into your browser:</p>
                <p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${safeUrl}" style="color:#5a5ae2;">${safeUrl}</a></p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#98a2b3;">${safeFooter}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: input.subject, html, text };
}
