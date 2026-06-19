import { createHash, randomBytes } from "crypto";
import type { AccessTokenPermission, WorkspaceRole } from "@app/database";

export const ACCESS_TOKEN_PREFIX = "ctk_";

const DISPLAY_PREFIX_LEN = ACCESS_TOKEN_PREFIX.length + 8;

export type GeneratedToken = { raw: string; hash: string; prefix: string };

export function generateAccessToken(): GeneratedToken {
  const raw = ACCESS_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { raw, hash: hashAccessToken(raw), prefix: raw.slice(0, DISPLAY_PREFIX_LEN) };
}

export function hashAccessToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function looksLikeAccessToken(token: string): boolean {
  return token.startsWith(ACCESS_TOKEN_PREFIX);
}

const PERMISSION_TO_WS_ROLE: Record<AccessTokenPermission, WorkspaceRole> = {
  VIEW: "READ",
  COMMENT: "COMMENT",
  EDIT: "EDIT",
  ADMIN: "ADMIN",
  MAINTAINER: "ADMIN",
};

export function permissionToWorkspaceRole(p: AccessTokenPermission): WorkspaceRole {
  return PERMISSION_TO_WS_ROLE[p];
}
