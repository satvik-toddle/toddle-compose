# UI Design Brief — Realm / Workspace RBAC (Toddle Compose)

> Paste this into a design tool (Figma Make, v0, Claude design, etc.) to generate the UI.
> It describes a multi-tenant collaborative-docs product's **access-control and workspace
> management** surfaces. Document *editing* itself is out of scope for this brief — focus on
> auth, realm administration, workspaces, and membership/role management.

---

## 1. Product in one paragraph

Toddle Compose is a real-time collaborative document app, organized as a single **Realm**
(the organization/tenant, e.g. "Toddle"). A realm contains many **Workspaces**. People are
added to the realm and to individual workspaces with **roles** that determine what they can do.
A user signs in once with their identity, sees the workspaces they can access, and **enters** a
workspace to work inside it (Slack/Notion-style). Realm administrators get a cross-workspace
admin console.

## 2. Roles (drives every permission-gated element)

**Realm roles** (hierarchy): `OWNER` > `MAINTAINER` > `MEMBER`
- **Owner** — the org boss (one, seeded). Manages maintainers, sees everything, can do anything.
- **Maintainer** — just below owner; can create/manage workspaces and manage realm members
  (but cannot manage other maintainers).
- **Member** — belongs to the realm; only sees/does what their workspace roles allow.

**Workspace roles** (cumulative ladder): `READ` < `COMMENT` < `EDIT` < `ADMIN`
- **Read** — view only. **Comment** — + comment. **Edit** — + create/edit pages.
- **Admin** — + manage workspace members & settings.
- Realm Owner/Maintainer implicitly act as workspace **Admin** in every workspace (an "overlay").

> Design must visibly reflect role: hide/disable actions a role can't perform, and show the
> user's current role as a badge/chip in context.

## 3. Primary user journeys

1. **Sign up** → account created (no access yet) → told to wait to be added.
2. **Log in** (email + password) → land on the **Workspace Launcher** (picker).
3. **Member**: picks a workspace they belong to → **enters** it → works inside.
4. **Realm admin**: sees the **Admin Console** (all workspaces, all realm members) and can also
   enter any single workspace to get its scoped view; **"Leave workspace"** returns to the all-
   workspaces view.
5. **Admin adds people**: by email + role, at realm level and/or workspace level.

## 4. Screens to design

### 4.1 Auth
- **Login** — email, password, "Sign in" button, link to register, inline error ("invalid
  credentials"). Branded, centered card.
- **Register** — name, email, password (+ confirm), strength hint, success state that explains
  "Your account is created. An admin needs to add you to a workspace before you can start."

### 4.2 Workspace Launcher (post-login home)
- Greeting with user's name + avatar (avatar uses the user's brand color).
- **List of accessible workspaces** as cards/rows: workspace name, icon, the user's role chip,
  member count. Click → enter.
- **Empty states:**
  - Realm owner/maintainer with zero workspaces → prominent **"Create your first workspace"** CTA.
  - Member with zero workspaces → friendly empty state: "You're not in any workspaces yet — ask
    an admin to add you."
- Realm admins additionally see a **"+ New workspace"** button and an **"Admin console"** entry.
- Account menu (top-right): name, email, realm-role badge, "Sign out".

### 4.3 Realm Admin Console (owner/maintainer only)
Two main tabs/sections:
- **Workspaces** — table of ALL workspaces in the realm: name, members count, created date,
  row actions (Open, Rename, Delete — delete behind a confirm). Header "+ New workspace".
- **Realm members** — table: avatar, name, email, **realm role** (Owner/Maintainer/Member),
  joined date. Actions: **Add member** (email + role select: Maintainer/Member), change role
  (inline dropdown; *Maintainer rows editable by Owner only*), remove (confirm; Owner row is
  locked/non-removable).
- Add-member is a **modal**: email field, role dropdown, validation (404 → "No user with that
  email — they must register first").

### 4.4 Create / Rename Workspace
- Modal or slim page: workspace **name**, optional icon/emoji. Create → you become its Admin and
  are dropped into it. Rename reuses the same form.

### 4.5 Inside a Workspace (after "enter")
- **Top bar:** workspace name + icon, a **workspace switcher** (dropdown listing other accessible
  workspaces + "Back to all workspaces" for admins), the user's **workspace-role chip**, account menu.
- **Left nav (placeholder):** "Pages" (greyed "coming soon" is fine — docs are out of scope here),
  and, for workspace Admins, a **"Members"** item.
- **Members panel** (Admin only): table of workspace members (avatar, name, email, workspace role),
  **Add member** modal (email + role: Read/Comment/Edit/Admin), change role inline, remove
  (cannot remove the last Admin — show a blocked tooltip).
- Non-admins: no Members management UI; they just see the (placeholder) workspace content area and
  their role chip.

### 4.6 Permission & error states
- **403 / not allowed** — actions a role can't take are hidden; if reached directly, show a clean
  "You don't have access to this" panel with a "Back to workspaces" button.
- **Session expired** — silent token refresh; on hard failure, bounce to Login.
- **Removed/demoted mid-session** — on next navigation, gracefully drop to the launcher (never a
  dead 403 page).

## 5. Reusable components
- Role **chip/badge** (two flavors: realm role, workspace role) with distinct, accessible colors.
- **User avatar** (initials on the user's brand color; palette below).
- **Member table** with inline role dropdown + remove.
- **Add-by-email modal** (email + role select + validation).
- **Workspace card** and **workspace switcher dropdown**.
- **Confirm-destructive dialog** (delete workspace, remove member).
- **Empty-state** illustration blocks.

## 6. Visual direction
- Clean, modern productivity-tool aesthetic (Notion/Linear/Slack family): generous spacing, soft
  shadows, rounded corners, neutral gray surfaces with one accent.
- **Brand color palette** (already used for user avatars — reuse for accents/avatars):
  `#f04c54` `#5a5ae2` `#00ac8a` `#e8653a` `#b646ee` `#00b0c2` `#ef4371` `#d67d00` `#6d9c00` `#a43dd7`.
- Light mode primary; dark mode a plus. Accessible contrast on all role chips and buttons.
- Responsive: launcher and tables collapse gracefully to a single column on mobile.

## 7. Role → visible-actions matrix (for designing show/hide)
| Action | Member (no ws role) | Read | Comment | Edit | WS Admin | Realm Maintainer | Realm Owner |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| See workspace in launcher | only if member | ✓ | ✓ | ✓ | ✓ | all | all |
| Enter workspace | — | ✓ | ✓ | ✓ | ✓ | any | any |
| Create workspace | — | — | — | — | — | ✓ | ✓ |
| Manage workspace members | — | — | — | — | ✓ | ✓ | ✓ |
| Admin console (all workspaces/members) | — | — | — | — | — | ✓ | ✓ |
| Add/remove realm members | — | — | — | — | — | ✓ (members only) | ✓ |
| Manage maintainers | — | — | — | — | — | — | ✓ |

## 8. Out of scope for this brief
Document/page editor, comments UI, real-time presence, folders, invitations for not-yet-registered
users, billing. Design the shells/placeholders only.
