# Design: Phasing out `isAdmin` → symmetric, role-based permissions

Status: **Draft for review** · Owner: TBD · Related: PR #64 (P0), PR #65 (P1)

## 1. Goal & product context

> "`isAdmin` should not be a check on the backend. Use more fine-grained checks
> like `canUpdateServerConfig` instead."

This underpins an **easier-to-self-host** release of Multiforum, modeled on
AWS / Rancher:

- Bootstrap with **one super-user (root)** that can do everything, including
  making admins. Operators are instructed to use it *only* to create
  **restricted admins** — accounts that are permissive but **cannot make other
  admins**.
- Server / channel / mod roles are **seeded in the DB** today. The self-host
  version keeps those seeds as **defaults** (= current behavior) and lets admins
  and channel owners define **more-restrictive non-default roles** and assign
  them. Not UI-editable yet (seed/config/mutation only); may come later.

## 2. Core model: membership connection → governing role (symmetric)

The system **already** resolves channel permissions this way
([`hasChannelPermission.ts`](../rules/permission/hasChannelPermission.ts)): a
user's *connection* to the `Channel` selects which role's permissions apply.
The plan is to make the **server scope symmetric** with the channel scope, and to
make every tier resolve to a **configurable role** (not a hardcoded bypass).

| Tier | Channel scope | Server scope | Governing role (seeded default, configurable) |
|---|---|---|---|
| Super-admin | — (owners are the channel apex) | `ServerConfig.SuperAdmins` | super-admin role — apex (holds `canManageAdmins`/`canManageSuperAdmins`) |
| Elevated | `Channel.Admins` (owners) | `ServerConfig.Admins` | admin role — permissive but **no** `canManageAdmins` (restricted by default) |
| Moderator | `Channel.Moderators` | `ServerConfig.Moderators` | mod role |
| Standard | (no special connection) | (no special connection) | default role — medium (vote + feedback, no hide/delete) |
| Suspended | `Channel.SuspendedUsers` / `SuspendedMods` | `ServerConfig.SuspendedUsers` / `SuspendedMods` | suspended role — restricted |

Channels have no super tier — the channel owner is the channel apex. The server
splits its apex into **SuperAdmins** (can manage admins) and **Admins**
(restricted, cannot) so super-administration can be delegated to a trusted group
without making every admin able to mint peers.

The schema already has the server-side default roles:
`ServerConfig.DefaultServerRole`, `DefaultModRole`, `DefaultElevatedModRole`,
`DefaultSuspendedRole`, `DefaultSuspendedModRole`, plus `Admins`, `Moderators`,
`SuspendedUsers`, `SuspendedMods`. The **only structural gap is an admin tier**
in the server permission *evaluation* (an admin/elevated `ServerRole` selected by
`Admins` membership). There should also be a **suspended admin** path, symmetric
with suspended users (the suspended role already exists).

### What "restricted admin" means in this model

The admin tier resolves to a **configurable** admin role, not a hardcoded
all-permissions bypass. The seeded default `Admins` role is **permissive but omits
`canManageAdmins`** — so *every regular admin is "restricted" by default*. The
ability to mint admins lives in the **SuperAdmins** tier (and root). Operators who
want someone able to invite admins add them to `ServerConfig.SuperAdmins`, not
`Admins`.

> Note: the *current* channel code gives channel owners **every** permission
> unconditionally (`isChannelAdmin → true`). The target model makes the
> owner/admin tier resolve to a configurable elevated role instead, so even
> owners/admins can be made more restrictive. See §8 Q1 — whether to align the
> channel side now or later.

## 3. Root (break-glass) + SuperAdmins (operational apex)

A single env super-admin is impractical (single point of failure, no team
delegation). So two distinct mechanisms:

- **Root — env bootstrap & break-glass** (`SUPERADMIN_EMAIL`, generalizing the
  existing `CYPRESS_ADMIN_TEST_EMAIL` shortcut in
  [`getServerScopedMembership.ts`](../rules/permission/getServerScopedMembership.ts)).
  Holds **all** capabilities unconditionally; immutable from the DB; can never be
  locked out. Its jobs: (a) seed the **first** SuperAdmin on a fresh install
  (cold-start), and (b) recover if `SuperAdmins` is ever emptied/misconfigured.
  Rarely used in normal operation.
- **`ServerConfig.SuperAdmins` — the operational apex group.** A DB-managed,
  **self-managing** membership tier whose role holds `canManageAdmins` and
  `canManageSuperAdmins`. This is the day-to-day "trusted operators" set: multiple
  people, no single point of failure.

`isAdmin` as a "you're in `Admins` ⇒ you can do anything" check is removed. Admin
power flows through the (configurable) tier roles; the only unconditional override
is the env root. Regular `Admins` are restricted (no `canManageAdmins`);
`SuperAdmins` and root mint admins.

## 4. Capabilities

`ServerRole` (user) and `ModServerRole` (mod) already hold fine-grained flags
(`canCreateDiscussion`, `canEditComments`, `canArchiveImage`, `canLockChannel`,
…). The gap is **server-administration** capabilities, currently gated only by
`isAdmin`. Add these (default off):

| Capability | Gates |
|---|---|
| `canManageServerSettings` | `updateServerConfigs`, `createServerConfigs`, `deleteServerConfigs`, `deleteFilterGroups`, `deleteFilterOptions` |
| `canManagePlugins` | `refreshPlugins`, `installPluginVersion`, `enableServerPlugin`, `setServerPluginSecret`, `deletePluginVersions` |
| `canManageRoles` | `create/deleteServerRoles`, `create/updateModServerRoles`, `create*ChannelRoles`, `deleteChannelRoles`¹ |
| `canManageMods` | `inviteServerMod`, `cancelInviteServerMod` |
| `canManageAdmins` (**apex**) | `inviteServerAdmin`, `cancelInviteServerAdmin` (SuperAdmins + root) |
| `canManageSuperAdmins` (**apex**) | add/remove `ServerConfig.SuperAdmins` (SuperAdmins self-manage + root) |
| `canManageServerMembers` | `emails` enumeration, `deleteEmails`², `deleteUsers`², `updateUsers`-on-others² |

¹ keep the existing `isChannelOwner` path for channel-scoped role deletes.
² keep the existing `isAccountOwner` path.

**Where they live:** extend `ServerRole` (least code — `hasServerPermission` keys
on `keyof ServerRole`; defaults off so `DefaultServerRole` grants none) vs. a
dedicated `ServerAdminRole`. Leaning `ServerRole` for Phase 1; see §8 Q3.

### Content-moderation `isAdmin` (the OR fallbacks)

Cases like `or(isCommentAuthor, isAdmin, canEditComments)` need **no new
capability**: drop `isAdmin` and rely on the existing mod capability. Admins keep
moderating because the **seeded admin bundle also grants the mod capabilities**
(an admin is connected such that they resolve a full `ServerRole` *and* a full
`ModServerRole`). Restricted admins get whatever their roles grant; root always
passes.

## 5. No-privilege-escalation invariant (load-bearing)

Once `canManageAdmins` / `canManageRoles` / `canManageMods` are grantable, an
actor must **never grant, assign, or edit a role to exceed their own resolved
capabilities** — else a restricted admin with `canManageRoles` just edits a role
to add `canManageAdmins`.

- `canManageAdmins` is the apex; root-only by default.
- Extends the P0 fix shipped in #64 (blocking role self-assignment via
  `updateUsers`) to the invite, role-assign, and role-edit paths.
- Mechanically: compare the requested capability set against the actor's resolved
  capabilities and reject any superset.

## 6. `ServerConfig.Admins` after the change

Keep it. It is the **membership connection** that selects the admin tier (like
`Channel.Admins` selects the channel owner tier) and the source for the existing
admin-management UI (`components/admin/ServerMembershipEditor.vue`,
`pages/admin/accept-admin-invite.vue`) — symmetric with the channel
`owners.vue` / `mods.vue` pages. So `Admins` membership is meaningful for
*display, invites, and tier selection*; it just no longer **implies all
permissions** — the admin *role* does that, configurably.

A new **`ServerConfig.SuperAdmins`** connection is added as a sibling tier (same
UI/invite pattern). It selects the super-admin role and is the only DB tier that
can manage admins/super-admins; the existing `ServerMembershipEditor` gains a
SuperAdmins section.

## 7. Evaluator changes, migration & rollout

### Evaluator
1. **Root override** in `hasServerPermission` / `hasServerModPermission`: env-root
   ⇒ `true` before role evaluation. No `Admins`-membership shortcut.
2. **Tier resolution (highest wins):** `SuperAdmins` → super-admin role,
   else `Admins` → admin role, else `Moderators` → mod role, else suspended →
   suspended role, else default role. Each is a configurable `ServerRole`
   (+ `ModServerRole`), not a hardcoded `true` — symmetric with the channel
   owner/mod/suspended/default resolution.
3. **Generalize the default-role fallback.** `evaluateServerPermission` hardcodes
   only `canCreateChannel` / `canUploadFile`
   ([hasServerPermission.ts:40-49](../rules/permission/hasServerPermission.ts));
   replace with generic `defaultServerRole[permission] === true`.
4. Suspension handling stays; ensure a **suspended admin** resolves the suspended
   role (symmetric with suspended users).

### Migration (one-time; root is the safety net)
1. Seed two server roles: **Super Administrator** (admin caps *with*
   `canManageAdmins`/`canManageSuperAdmins`) and **Administrator** (admin caps
   *without* them), plus the full `ModServerRole` for both.
2. Wire the roles to their tiers: `ServerConfig.SuperAdmins` → Super Administrator,
   `ServerConfig.Admins` → Administrator.
3. **Backfill existing `Admins` into `SuperAdmins`** to preserve their current
   full power (they can manage admins today). Operators then *demote* specific
   people to restricted `Admins` as desired — nobody silently loses the ability
   to manage admins.
4. Designate the env root (`SUPERADMIN_EMAIL`). Verify root + a migrated
   super-admin can authenticate before removing the `isAdmin` path.

### Phasing (separate PRs)
1. **PR-1** — add admin capability flags to `ServerRole`; add the
   `ServerConfig.SuperAdmins` connection; add root override + the SuperAdmin/Admin
   tier resolution + generic default-role fallback to the evaluators; add the new
   rules. **No call sites converted → no behavior change.** Tests.
2. **PR-2 (migration)** — seed roles, backfill admins, wire env root; maintenance
   window.
3. **PR-3** — convert Category-A call sites to capability checks; drop `isAdmin`
   from Category-B ORs; remove the `isAdmin` rule. Integration coverage for a
   restricted admin.
4. **PR-4** — enforce the no-escalation invariant on invite / assign / role-edit.
5. **PR-5 (later)** — role-management UI; (optional) align the channel owner tier
   to the configurable-role model for full symmetry.

`isAdmin` keeps working until PR-2 is verified per environment; only PR-3 removes
it. Frontend: none required until PR-5.

## 8. Decisions & open questions

**Resolved (with the operator):**
- **Pure role-based** with two apex mechanisms: an **env break-glass root**
  (bootstrap + recovery) and a DB **`ServerConfig.SuperAdmins`** group (the
  practical, self-managing apex) — a single env super-admin alone is impractical.
- **Keep `ServerConfig.Admins`** for display / invites / tier selection; regular
  admins are restricted (no `canManageAdmins`).
- **Separate `canManageAdmins` vs `canManageMods`**; both apex caps live on the
  SuperAdmin role; root holds everything.
- **Server scope mirrors channel scope**, including a **suspended admin** tier;
  the server adds a SuperAdmin tier above Admins (channels keep owner as apex).

**Still open:**
1. **Align the channel owner tier now or later?** Today channel owners get *all*
   permissions unconditionally; the symmetric/configurable model makes the
   owner/admin tier a configurable elevated role. Align channels in this effort,
   or keep channel-owner=all for now and only build the server admin tier
   configurable? (Recommend: build server configurable now; align channels in
   PR-5.)
2. **`emails` enumeration** — `canManageServerMembers`, or keep strictly
   root/admin (privacy-sensitive)?
3. **Schema home for admin caps** — extend `ServerRole` (Phase 1 lean) vs. a
   dedicated `ServerAdminRole` type.
4. **`updateUsers` on other users** — under `canManageServerMembers`, or
   root/admin-only?
5. **`deleteDiscussionChannels` / `deleteEventChannels`** —
   `canManageServerSettings`, a content-mod perm, or admin-only?

## 9. Testing
- Unit: extend `hasServerPermission.test.ts` / `hasServerModPermission.test.ts`
  for the root override, the admin tier, the suspended-admin path, and the
  generalized default-role fallback (pure-function seams already exist).
- Unit: one test per new capability rule (granted via admin role / via default
  role / denied) following the existing `evaluate*` pattern.
- Integration: extend `authenticatedRoles.test.ts` — a restricted admin passes a
  granted capability and is denied `canManageAdmins`; root passes everything.
