import { renderActionEmail, type RenderedEmail } from "./action-email";

export type EmailVerificationTemplateInput = {
  name: string;
  verifyUrl: string;
  /** Token lifetime in minutes, surfaced to the reader. */
  expiresInMinutes: number;
};

export function renderEmailVerification(
  input: EmailVerificationTemplateInput
): RenderedEmail {
  return renderActionEmail({
    subject: "Verify your Toddle Compose account",
    heading: "Confirm your email",
    name: input.name,
    intro:
      "thanks for signing up for Toddle Compose. Click the button below to verify your email address and activate your account.",
    buttonLabel: "Verify my email",
    url: input.verifyUrl,
    footer: `This link expires in ${input.expiresInMinutes} minutes. If you didn't create this account, you can safely ignore this email.`,
  });
}
