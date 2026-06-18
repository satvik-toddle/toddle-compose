// Role enums mirror the backend Prisma schema exactly (verified in code).
export type RealmRole = 'OWNER' | 'MAINTAINER' | 'MEMBER';
export type WorkspaceRole = 'READ' | 'COMMENT' | 'EDIT' | 'ADMIN';
export type Visibility = 'PUBLIC' | 'PRIVATE';
export type JoinRequestState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

// Cumulative ordering used for comparisons + MAX resolution.
export const REALM_ORDER: Record<RealmRole, number> = { MEMBER: 0, MAINTAINER: 1, OWNER: 2 };
export const WS_ORDER: Record<WorkspaceRole, number> = { READ: 0, COMMENT: 1, EDIT: 2, ADMIN: 3 };
