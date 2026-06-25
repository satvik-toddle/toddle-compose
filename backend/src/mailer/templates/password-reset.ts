import { renderActionEmail, type RenderedEmail } from "./action-email";

export type PasswordResetTemplateInput = {
  name: string;
  resetUrl: string;
  /** Token lifetime in minutes, surfaced to the reader. */
  expiresInMinutes: number;
};

export function renderPasswordReset(
  input: PasswordResetTemplateInput
): RenderedEmail {
  return renderActionEmail({
    subject: "Reset your Toddle Compose password",
    heading: "Reset your password",
    name: input.name,
    intro:
      "we received a request to reset the password for your Toddle Compose account. Click the button below to choose a new one.",
    buttonLabel: "Reset my password",
    url: input.resetUrl,
    footer: `This link expires in ${input.expiresInMinutes} minutes. If you didn't request this, you can safely ignore this email — your password won't change.`,
  });
}
