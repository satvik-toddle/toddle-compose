# Realm / Workspace RBAC — Scope & Implementation Spec

> Status: **design / not yet implemented**. This document defines the scope for adding
> a Realm → Workspace → Document access-control layer on top of the existing
> per-document owner + private/public model. Implement as a dedicated phase; the
> current P1 owner model keeps working underneath throughout.
>
> **Repos:** `toddle-compose` = production code (target of this work).
> `toddlecompose` = the POC being migrated; the code references in this spec
> (`AuthorizationService`, `mintRtcToken`, `tokens.service`, `yjs-server`) are the POC's
> proven shapes and carry over to production.

---

## 1. Goal

Introduce org-level multi-tenant access control:

```
Realm (e.g. "Toddle")
 └─ Workspace (many per realm; users can belong to multiple)
     └─ Document (existing model, gains workspaceId)
```

- A user signs in once, sees the workspaces they can discover, and **switches**
  between the workspaces they belong to (Slack/Notion-style switcher).
- Workspaces are **public** (open join) or **private** (request → approval).
- Roles are assigned **per workspace**; the realm owner has a cross-workspace overlay.

This replaces the informal "all docs are per-user" assumption with a scoped model,
**without breaking** the current `owner || public` document rule (it becomes a
special case of the resolver — see §5).

---

## 2. Roles & capabilities

### Workspace roles (cumulative)

| Capability → AuthZ predicate | Viewer | Commenter | Editor | Manager | Admin | Owner |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| read docs → `canRead`                         | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| comment → `canComment`                        |   | ✓ | ✓ | ✓ | ✓ | ✓ |
| edit docs → `canWrite`                        |   |   | ✓ | ✓ | ✓ | ✓ |
| create docs → `canCreate`                     |   |   |   | ✓ | ✓ | ✓ |
| delete / move / set visibility → `canManageDoc` |  |   | own | ✓ | ✓ | ✓ |
| approve join requests → `canApprove`          |   |   |   |   | ✓ | ✓ |
| manage members & roles → `canManageMembers`   |   |   |   |   | ✓ | ✓ |
| workspace settings → `canManageWorkspace`     |   |   |   |   | ✓ | ✓ |
| delete / transfer workspace → `canAdminWorkspace` | |  |   |   |   | ✓ |

### Realm roles (overlay onto every workspace in the realm)

| Capability | Member | Owner |
|---|:--:|:--:|
| belong to realm, join public workspaces | ✓ | ✓ |
| read all docs in all workspaces (projects to workspace `Viewer`) |  | ✓ |
| approve join requests (fallback approver) |  | ✓ |
| create / manage workspaces |  | ✓ |

> Realm `Owner` projects onto each workspace as **at least `Viewer` + approve**.
> If realm owner should also edit everywhere, bump the projection to `Editor` —
> this must be a **single constant**, not scattered checks.

### Collapse to the RTC token role

The whole matrix exists to resolve `(user, doc)` to one of the RTC token roles the
rtc-server already understands:

```
!canRead            → "denied"   // tokens.service.verify() throws; WS connection refused
 canWrite           → "editor"   // full Yjs read/write
 canRead && !canWrite→ "viewer"  // yjs-server drops every write frame (already implemented)
```

`"denied"` is already wired end-to-end in `tokens.service` but never emitted today —
with workspaces, "member of workspace, no access to this doc" is a real state, so emit it.

**Commenter note:** the RTC role is binary (editor writes Yjs / viewer cannot). Commenter
therefore = `viewer` at the CRDT level; comments are stored **outside** the Yjs doc
(separate `Comment` table + authz'd REST endpoint). Do *not* add a third RTC role.

---

## 3. Data model (Prisma — additive)

`Document` gains `workspaceId`; everything else is new. `RtcDocument` / `RtcDocumentUpdate`
are unchanged.

```prisma
enum WorkspaceRole { VIEWER COMMENTER EDITOR MANAGER ADMIN OWNER }
enum RealmRole     { MEMBER OWNER }
enum JoinPolicy    { OPEN REQUEST INVITE_ONLY }
enum JoinState     { PENDING APPROVED REJECTED WITHDRAWN }

model Realm {
  id         String       @id @default(cuid())
  name       String
  workspaces Workspace[]
  members    RealmMember[]
}

model Workspace {
  id           String            @id @default(cuid())
  realmId      String            @map("realm_id")
  realm        Realm             @relation(fields: [realmId], references: [id], onDelete: Cascade)
  name         String
  discoverable Boolean           @default(true)          // listing ≠ join policy
  joinPolicy   JoinPolicy        @default(REQUEST)       @map("join_policy")
  defaultRole  WorkspaceRole     @default(VIEWER)        @map("default_role")
  members      WorkspaceMember[]
  documents    Document[]
  joinRequests JoinRequest[]
  @@index([realmId])
}

model RealmMember {
  realmId String    @map("realm_id")
  userId  String    @map("user_id")
  role    RealmRole @default(MEMBER)
  @@id([realmId, userId])
}

model WorkspaceMember {
  workspaceId String        @map("workspace_id")
  userId      String        @map("user_id")
  role        WorkspaceRole
  grantedById String?       @map("granted_by_id")
  createdAt   DateTime      @default(now()) @map("created_at")
  @@id([workspaceId, userId])
  @@index([userId])
}

model JoinRequest {
  id            String        @id @default(cuid())
  workspaceId   String        @map("workspace_id")
  userId        String        @map("user_id")
  state         JoinState     @default(PENDING)
  requestedRole WorkspaceRole @default(VIEWER)
  decidedById   String?       @map("decided_by_id")
  createdAt     DateTime      @default(now()) @map("created_at")
  @@unique([workspaceId, userId, state])                 // blocks duplicate PENDING spam
}

// Document gains:
//   workspaceId String?  @map("workspace_id")   // nullable during migration, then required
//   @@index([workspaceId])
```

> Alternative: a single polymorphic `Grant(subjectType, subjectId, scopeType, scopeId, role)`
> table generalises realm/workspace/**doc** grants and makes per-doc sharing trivial later.
> The two-table form above is closer to the current code style; pick one before migrating.

---

## 4. Visibility vs join policy (two independent axes)

Do not conflate them:

- **`discoverable`** — does the workspace appear in the "all workspaces" list? (hidden ⇒ invite-only-discovery)
- **`joinPolicy`** — `OPEN` (instant join as `defaultRole`) / `REQUEST` (approval) / `INVITE_ONLY` (no self-join).

Listing rules: show only `discoverable` workspaces **within the user's realm**, metadata only
(name/icon/member count) — never contents. Private workspace contents stay hidden until membership.

---

## 5. Permission resolution (the single rule)

Effective workspace role = **MAX** over all applicable grants on the resource's ancestor chain:

```ts
resolveRole(ctx): WorkspaceRole | null {
  const fromRealm = ctx.realmRole === "OWNER" ? "VIEWER" /* +approve flag */ : null;
  const fromWs    = ctx.workspaceMember?.role ?? null;
  const fromDoc   = ctx.docOwnerId === ctx.userId ? "OWNER" : null; // preserves today's owner rule
  return maxRole(fromRealm, fromWs, fromDoc);   // null ⇒ "denied"
}
```

Backward-compat mapping of the existing `Visibility` column:
- `PUBLIC`  ⇒ workspace members get at least `VIEWER` on the doc.
- `PRIVATE` ⇒ only doc owner + workspace `Manager`+.

All capability predicates (`canRead`/`canWrite`/`canCreate`/…) read the **single** resolved
role. Keep them in `AuthorizationService` — it stays the only authz choke point.

---

## 6. Workspace switching

- Carry **active workspace** explicitly on every request — prefer path scoping
  (`/workspaces/:id/documents`) over inferring it; never let the server guess.
- Switching is **not** re-auth: identity JWT unchanged; only scope changes. But per-doc
  **RTC tokens must be re-minted per workspace** (they carry the resolved role).
- Persist **last-active workspace** per user; on revoked access, fall back to the
  workspace picker (don't 403 into a dead end).
- Realm-owner "see everything" view is a **distinct route/permission** from a member's
  scoped view — keep it explicit and audited.
- Re-interpret sidebar tabs as workspace-scoped: All / My / Shared are within the active workspace.

---

## 7. Join & invite lifecycle

- **Request (pull):** `PENDING → APPROVED | REJECTED | WITHDRAWN`. Approver picks the role
  at approval time (defaults to `requestedRole`). Re-request after rejection with a cooldown.
- **Invite (push):** admin invites by email (incl. users not yet registered) → onboarding.
- **Approvers:** workspace `Admin`/`Owner` first; realm `Owner` is the fallback, not the routine path.
- Notify approvers of pending requests; handle races (double-approve, withdraw-while-approving).

---

## 8. Known gaps to close (confirmed against current code)

1. **Audit log — IN SCOPE.** Add an `AuditLog` model. Log role changes, approvals/rejections,
   join/leave, visibility changes, and especially realm-owner cross-workspace doc access
   (privacy/compliance). See §8a for the model.
2. **Groups/teams.** Per-user-per-workspace grants don't scale; add group-based grants later.
3. **Ownership transfer / multiple owners.** Avoid single-owner lockout for realm and workspace.

**Out of scope (deferred):**
- **Mid-session revocation.** RTC tokens stay **TTL-only** for now. On demote/evict the open
  socket keeps editing until the token expires — accepted for this phase. Keep `RTC_TOKEN_TTL_SEC`
  short to bound the window. Revisit with a `yjs-server` connect re-validation + kick endpoint later.

## 8a. Audit log (in scope)

```prisma
enum AuditAction {
  ROLE_GRANTED ROLE_CHANGED ROLE_REVOKED
  MEMBER_JOINED MEMBER_LEFT MEMBER_REMOVED
  JOIN_REQUESTED JOIN_APPROVED JOIN_REJECTED
  DOC_VISIBILITY_CHANGED
  REALM_OWNER_DOC_ACCESS          // realm owner reading a doc they aren't a workspace member of
}

model AuditLog {
  id          String      @id @default(cuid())
  realmId     String      @map("realm_id")
  workspaceId String?     @map("workspace_id")   // null for realm-scoped events
  actorId     String      @map("actor_id")       // who performed the action
  targetUserId String?    @map("target_user_id") // affected user, if any
  action      AuditAction
  resourceType String?    @map("resource_type")  // "document" | "workspace" | "membership" | ...
  resourceId  String?     @map("resource_id")
  metadata    Json?                              // before/after role, etc.
  createdAt   DateTime    @default(now()) @map("created_at")
  @@index([realmId, createdAt])
  @@index([workspaceId, createdAt])
  @@index([actorId])
}
```

Write audit entries from `AuthorizationService`/the membership & join services (the same choke
points), so logging can't be bypassed by a controller that forgets to call it.

---

## 9. Suggested task breakdown (phase: Realm/Workspace RBAC)

**Backend**
- [ ] Prisma: `Realm`, `Workspace`, `RealmMember`, `WorkspaceMember`, `JoinRequest` + `Document.workspaceId`; migration.
- [ ] Data migration: create a default realm + default workspace; attach all existing docs/users.
- [ ] Expand `AuthorizationService`: capability predicates + `resolveRole` (MAX over realm/workspace/doc).
- [ ] `mintRtcToken`: emit three-way `editor | viewer | denied`.
- [ ] Workspaces module: CRUD + settings (`discoverable`, `joinPolicy`, `defaultRole`).
- [ ] Membership module: assign / demote / remove roles (`canManageMembers`).
- [ ] Join flow: request / approve / reject / withdraw + invite-by-email.
- [ ] `AuditLog` model + write path (from authz/membership/join services) for role changes,
      approvals, join/leave, visibility changes & realm-owner cross-workspace reads.

**RTC server**
- [ ] No changes this phase. RTC stays TTL-token based; viewer write-drop already enforced.
      (Mid-session revocation deferred — see §8.)

**Frontend**
- [ ] Workspace switcher + last-active persistence.
- [ ] Discoverable-workspace list with Join (public) / Request (private) actions.
- [ ] Admin: member management + pending-requests queue.
- [ ] Realm-owner all-docs view (distinct route).

**Infra / tests**
- [ ] Extend the authorization test suite into the full RBAC matrix (role × capability × scope).