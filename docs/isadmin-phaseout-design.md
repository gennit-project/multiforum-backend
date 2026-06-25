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
| Elevated | `Channel.Admins` (owners) | `ServerConfig.Admins` | elevated/admin role — permissive |
| Moderator | `Channel.Moderators` | `ServerConfig.Moderators` | mod role |
| Standard | (no special connection) | (no special connection) | default role — medium (vote + feedback, no hide/delete) |
| Suspended | `Channel.SuspendedUsers` / `SuspendedMods` | `ServerConfig.SuspendedUsers` / `SuspendedMods` | suspended role — restricted |

The schema already has the server-side default roles:
`ServerConfig.DefaultServerRole`, `DefaultModRole`, `DefaultElevatedModRole`,
`DefaultSuspendedRole`, `DefaultSuspendedModRole`, plus `Admins`, `Moderators`,
`SuspendedUsers`, `SuspendedMods`. The **only structural gap is an admin tier**
in the server permission *evaluation* (an admin/elevated `ServerRole` selected by
`Admins` membership). There should also be a **suspended admin** path, symmetric
with suspended users (the suspended role already exists).

### What "restricted admin" means in this model

The admin tier resolves to a **configurable** admin role, not a hardcoded
all-permissions bypass. The seeded default admin role is **permissive but omits
`canManageAdmins`** — so *every DB admin is "restricted" by default*, and only
**root** can mint admins. Operators who want a DB admin that can invite peers
configure the admin role (or, future, assign a distinct elevated role) to include
`canManageAdmins`.

> Note: the *current* channel code gives channel owners **every** permission
> unconditionally (`isChannelAdmin → true`). The target model makes the
> owner/admin tier resolve to a configurable elevated role instead, so even
> owners/admins can be made more restrictive. See §8 Q1 — whether to align the
> channel side now or later.

## 3. Root: the only hardcoded super-user

- **Root identity from env** (`SUPERADMIN_EMAIL`), generalizing the existing
  `CYPRESS_ADMIN_TEST_EMAIL` shortcut in
  [`getServerScopedMembership.ts`](../rules/permission/getServerScopedMembership.ts).
- Holds **all** capabilities unconditionally; can never be locked out; the only
  account holding `canManageAdmins` out of the box.
- It is the recovery path if role data is misconfigured — which is what makes the
  migration (§7) safe.
- This is the **only** membership-style override that remains. `isAdmin` as a
  "you're in `Admins` ⇒ you can do anything" check is removed; admin power flows
  through the (configurable) admin role like every other tier.

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
| `canManageAdmins` (**apex**) | `inviteServerAdmin`, `cancelInviteServerAdmin` |
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

## 7. Evaluator changes, migration & rollout

### Evaluator
1. **Root override** in `hasServerPermission` / `hasServerModPermission`: env-root
   ⇒ `true` before role evaluation. No `Admins`-membership shortcut.
2. **Admin tier:** when the caller is in `ServerConfig.Admins`, evaluate against
   the admin/elevated `ServerRole` (+ `ModServerRole`), symmetric with the
   channel owner tier — but via a configurable role, not a hardcoded `true`.
3. **Generalize the default-role fallback.** `evaluateServerPermission` hardcodes
   only `canCreateChannel` / `canUploadFile`
   ([hasServerPermission.ts:40-49](../rules/permission/hasServerPermission.ts));
   replace with generic `defaultServerRole[permission] === true`.
4. Suspension handling stays; ensure a **suspended admin** resolves the suspended
   role (symmetric with suspended users).

### Migration (one-time; root is the safety net)
1. Seed the **Administrator** `ServerRole` (admin caps, default **without**
   `canManageAdmins`) and a full `ModServerRole`; optionally a permissive
   "Super Administrator" variant *with* `canManageAdmins`.
2. Connect the admin/elevated role as the role resolved for `ServerConfig.Admins`
   membership; backfill existing admins.
3. Designate the env root (`SUPERADMIN_EMAIL`). Verify root + a migrated admin can
   authenticate before removing the `isAdmin` path.

### Phasing (separate PRs)
1. **PR-1** — add admin capability flags to `ServerRole`; add root override + the
   admin tier + generic default-role fallback to the evaluators; add the new
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
- **Pure role-based with env-only break-glass root** (no superuser-by-membership).
- **`SUPERADMIN_EMAIL` env root** for now.
- **Keep `ServerConfig.Admins`** for display / invites / tier selection.
- **Separate `canManageAdmins` vs `canManageMods`**; `canManageAdmins` is apex,
  root-only by default → restricted admins are the default.
- **Server scope mirrors channel scope**, including a **suspended admin** tier.

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
