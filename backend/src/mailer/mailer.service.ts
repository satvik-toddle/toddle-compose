import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { type Transporter } from "nodemailer";
import type { Env } from "../config/env";
import { type RenderedEmail } from "./templates/action-email";
import {
  renderEmailVerification,
  type EmailVerificationTemplateInput,
} from "./templates/email-verification";
import {
  renderPasswordReset,
  type PasswordResetTemplateInput,
} from "./templates/password-reset";
import {
  renderDocShared,
  type DocSharedTemplateInput,
} from "./templates/doc-shared";

export type SendResult = { delivered: boolean };

// Transport selection is decided once at startup:
//   - BYPASS_EMAIL_SERVICE=true → no email service at all; every send is a no-op
//   - GMAIL_SERVICE_EMAIL + GMAIL_SERVICE_PASSWORD set → real Gmail SMTP
//   - otherwise → a console transport that logs the message (incl. verify link)
// so local development needs no SMTP credentials.
@Injectable()
export class MailerService implements OnModuleInit {
  private readonly log = new Logger("Mailer");
  private transporter!: Transporter;
  private readonly from: string;
  private gmailConfigured = false;
  private bypassed = false;

  constructor(private readonly config: ConfigService<Env, true>) {
    const fromName = this.config.get("MAIL_FROM_NAME", { infer: true });
    const fromAddress =
      this.config.get("GMAIL_SERVICE_EMAIL", { infer: true }) ??
      "no-reply@toddle.test";
    this.from = `${fromName} <${fromAddress}>`;
  }

  onModuleInit(): void {
    // No email service at all: skip transport setup; send() short-circuits.
    if (this.config.get("BYPASS_EMAIL_SERVICE", { infer: true })) {
      this.bypassed = true;
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
      this.log.warn(
        "BYPASS_EMAIL_SERVICE is on — no emails (verification, password reset) will be sent"
      );
      return;
    }

    const user = this.config.get("GMAIL_SERVICE_EMAIL", { infer: true });
    const pass = this.config.get("GMAIL_SERVICE_PASSWORD", { infer: true });

    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user, pass },
      });
      this.gmailConfigured = true;
      this.log.log(`Gmail SMTP transport ready (sending as ${user})`);
    } else {
      // jsonTransport just serialises the message instead of sending it; we log
      // it ourselves below so the verify link is visible during local dev.
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
      this.log.warn(
        "GMAIL_SERVICE_EMAIL/PASSWORD not set — emails will be logged to the console, not delivered"
      );
    }
  }

  // True when there is no email service, so callers can skip email-dependent steps.
  isBypassed(): boolean {
    return this.bypassed;
  }

  async sendEmailVerification(
    to: string,
    input: EmailVerificationTemplateInput
  ): Promise<SendResult> {
    return this.send(to, renderEmailVerification(input), "verification", input.verifyUrl);
  }

  async sendPasswordReset(
    to: string,
    input: PasswordResetTemplateInput
  ): Promise<SendResult> {
    return this.send(to, renderPasswordReset(input), "password-reset", input.resetUrl);
  }

  async sendDocShared(
    to: string,
    input: DocSharedTemplateInput
  ): Promise<SendResult> {
    return this.send(to, renderDocShared(input), "doc-shared", input.docUrl);
  }

  // Shared delivery path: in dev (no Gmail) the link is logged so the flow is
  // testable; SMTP failures are swallowed (the caller's action already
  // succeeded and the user can retry) and reported via `delivered`.
  private async send(
    to: string,
    msg: RenderedEmail,
    kind: string,
    devLink: string
  ): Promise<SendResult> {
    // No email service: nothing is sent and no link is logged.
    if (this.bypassed) return { delivered: false };
    if (!this.gmailConfigured) {
      this.log.log(`[dev] ${kind} email for ${to} — link: ${devLink}`);
      return { delivered: false };
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });
      return { delivered: true };
    } catch (err) {
      this.log.error(`failed to send ${kind} email to ${to}`, err as Error);
      return { delivered: false };
    }
  }
}
