import type { WorkspaceRole } from "@app/database";
import { renderActionEmail, type RenderedEmail } from "./action-email";

export type DocSharedTemplateInput = {
  /** Grantee's name (the recipient). */
  name: string;
  granterName: string;
  docTitle: string;
  role: WorkspaceRole;
  docUrl: string;
};

// Human labels for the granted role, surfaced to the reader.
const ROLE_LABELS: Record<WorkspaceRole, string> = {
  READ: "Read",
  COMMENT: "Comment",
  EDIT: "Edit",
  ADMIN: "Admin",
};

export function renderDocShared(input: DocSharedTemplateInput): RenderedEmail {
  return renderActionEmail({
    subject: `${input.granterName} shared “${input.docTitle}” with you`,
    heading: "A doc was shared with you",
    name: input.name,
    intro: `${input.granterName} has shared a doc with you (${ROLE_LABELS[input.role]} access). Click the button below to view it.`,
    buttonLabel: "View doc",
    url: input.docUrl,
    footer: "If you weren't expecting this, you can safely ignore this email.",
  });
}
