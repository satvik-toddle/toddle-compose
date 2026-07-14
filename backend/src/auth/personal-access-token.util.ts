import { createHash, randomBytes } from "crypto";
import type { PersonalAccessTokenPermission, WorkspaceRole } from "@app/database";

export const PERSONAL_ACCESS_TOKEN_PREFIX = "ctk_";

const DISPLAY_PREFIX_LEN = PERSONAL_ACCESS_TOKEN_PREFIX.length + 8;

export type GeneratedToken = { raw: string; hash: string; prefix: string };

export function generatePersonalAccessToken(): GeneratedToken {
  const raw = PERSONAL_ACCESS_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { raw, hash: hashPersonalAccessToken(raw), prefix: raw.slice(0, DISPLAY_PREFIX_LEN) };
}

export function hashPersonalAccessToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function looksLikePersonalAccessToken(token: string): boolean {
  return token.startsWith(PERSONAL_ACCESS_TOKEN_PREFIX);
}

const PERMISSION_TO_WS_ROLE: Record<PersonalAccessTokenPermission, WorkspaceRole> = {
  VIEW: "READ",
  COMMENT: "COMMENT",
  EDIT: "EDIT",
  ADMIN: "ADMIN",
  MAINTAINER: "ADMIN",
};

export function permissionToWorkspaceRole(p: PersonalAccessTokenPermission): WorkspaceRole {
  return PERMISSION_TO_WS_ROLE[p];
}
