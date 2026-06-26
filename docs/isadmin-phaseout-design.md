# Design: Phasing out `isAdmin` → symmetric, role-based permissions

Status: **Implemented** (PR-1 → PR-4c; see §7 Phasing for the per-stage status).
The remaining work is rollout/cleanup, not the core model. · Related: PR #64
(P0), PR #65 (P1). For the resulting system, see
[permission-system.md](./permission-system.md).

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

Plus destructive structural caps on **`ModServerRole`**: `canRemoveDiscussionChannel`,
`canRemoveEventChannel` (for `deleteDiscussionChannels` / `deleteEventChannels`).

¹ keep the existing `isChannelOwner` path for channel-scoped role deletes.

There is **no `canManageServerMembers`**: `emails` enumeration is denied outright
(§8.2), `deleteEmails`/`deleteUsers` keep their `isAccountOwner` path, and
`updateUsers` is self-only (§8.4). Cross-user admin actions happen only through
the existing invite flows.

**Where they live (decided):** extend `ServerRole` for creative caps and
`ModServerRole` for destructive caps — no dedicated admin role type. Defaults off,
so `DefaultServerRole`/`DefaultModRole` grant none.

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

### Seed-data architecture (single source of truth)

The default roles are defined once, in **`seedData/`**, and consumed by every
caller that needs them — so a fresh self-hosted instance, the migration, and the
integration tests all use the *same* definitions instead of three drifting copies
(previously: frontend Cypress fixtures, inline per-test seeding, and nothing for
production):

- `seedData/defaultRoles.ts` — canonical `ServerRole` / `ModServerRole` /
  `ChannelRole` definitions (incl. the **Administrator** vs **Super Administrator**
  split) and the `ServerConfig` tier→role wiring map.
- `seedData/provisionServerDefaults.ts` — **idempotent** (upsert by role name,
  `overwrite` on the config links), so it is safe to run on every boot/deploy and
  in test setup. Also performs the admin→SuperAdmin backfill.
- `npm run provision` (`build_scripts/provisionServerDefaults.ts`) — runnable
  entry for bootstrapping/upgrading an instance.
- Integration tests call `provisionServerDefaults` in setup (incremental
  adoption) so they exercise the real defaults.

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

1. **PR-1 — evaluator & schema groundwork. 🟡 IN PROGRESS.** No call sites
   converted → no behavior change.
   - ✅ Schema: admin "creative" caps on `ServerRole`
     (`canManageServerSettings/Plugins/Roles/Mods/Admins/SuperAdmins`); destructive
     caps on `ModServerRole` (`canRemoveDiscussionChannel/EventChannel`);
     `ServerConfig.SuperAdmins` connection + `DefaultAdminRole` /
     `DefaultSuperAdminRole` links. Codegen run.
   - ✅ Evaluator: env break-glass root override (`isServerRoot`, `SUPERADMIN_EMAIL`)
     in `hasServerPermission` + `hasServerModPermission`; SuperAdmin/Admin tier
     resolution with **fallback to `DefaultServerRole`** (so unseeded tiers keep
     current behavior); generic default-role check replacing the hard-coded
     `canCreateChannel`/`canUploadFile` branches. `getServerConfigForPermissions`
     fetches the new fields. Unit tests added (root, super-admin, restricted-admin,
     tier fallback, suspended-admin, generic capability).
   - ✅ `emails` query → `deny` (decision: only direct DB access reads emails).
   - ✅ Align the **channel owner tier** to a configurable elevated role:
     `Channel.ElevatedChannelRole` field added (codegen run); `hasChannelPermission`
     resolves owners via `evaluateChannelOwnerPermission` (fallback to all-perms
     until a role is configured). Unit test added.
2. **PR-2 (seed defaults + migration). 🟡 IN PROGRESS.**
   - ✅ `seedData/` single-source-of-truth module + idempotent
     `provisionServerDefaults` (roles, config wiring, admin→SuperAdmin backfill);
     `npm run provision` entry; unit tests.
   - 🔲 Adopt `provisionServerDefaults` in integration-test setup (incremental).
   - 🔲 Wire env root (`SUPERADMIN_EMAIL`) in deploy config; run provisioning per
     environment in a maintenance window.
3. **PR-3 — ✅ DONE.** PR-3a (#72) converted Category-A call sites to capability
   checks; PR-3b (#73) dropped `isAdmin` from the Category-B ORs and removed the
   `isAdmin` rule, replacing it with a server-admin + root override
   (`passesAsServerAdminOrRoot`) inside the channel/ownership rules. `updateUsers`/
   `deleteUsers`/`deleteEmails` are self-only; the dangerous Cypress seams use the
   env-root-only `isRoot`; `reportProfilePicture` uses `canReportServerContent`.
3.5. **PR-3.5 — suspended-admin path. ✅ DONE.** The override is **server-
   suspension-aware**: a server-suspended admin loses the blanket override and
   falls through to the normal (restricted) role checks everywhere (channel,
   ownership, and server-mod). `hasServerModPermission` no longer lets a suspended
   admin bypass the suspended role. **Root is the only actor a suspension cannot
   stop.** Server suspension (`scope: 'server'`) is the lever to restrict an admin;
   channel-level roles intentionally do *not* restrict an un-suspended admin (they
   are server staff). Unit tests: `serverAdminOverride.test.ts` (pure
   `evaluateAdminOverride`) + a suspended-admin case in `hasServerModPermission.test.ts`.
4. **PR-4 — no-privilege-escalation invariant. ✅ DONE (server roles).** Role
   authoring is now gated by a capability-superset check in addition to
   `canManageRoles`: `createServerRoles` / `createModServerRoles` /
   `updateModServerRoles` reject any input that sets a capability `true` the actor
   does not hold (so a restricted admin with `canManageRoles` cannot mint
   `canManageAdmins`). Root bypasses; if the actor's role can't be resolved the
   guard fails closed. Implemented as `rules/permission/actorCapabilities.ts`
   (effective-role resolution, reusing the tier logic) + a pure, unit-tested
   `findEscalatedCapabilities` in `rules/validation/roleEscalation.ts`. Assignment
   is already covered: `updateUsers` role-connect is blocked (#64), and the invite
   flows grant fixed tier roles (the inviter never chooses capabilities).
   - ✅ **PR-4b — nested ServerConfig escalation closed.** The generated
     `ServerConfig` create/update input allows nested role writes on the tier
     relationships (`DefaultAdminRole`, `DefaultServerRole`, …), reachable via
     `updateServerConfigs`/`createServerConfigs` (gated only by
     `canManageServerSettings`) — e.g.
     `updateServerConfigs(update: { DefaultAdminRole: { update: { node: { canManageAdmins: true } } } })`.
     `serverConfigInputDoesNotEscalate` (`rules/validation/nestedRoleEscalation.ts`)
     now walks those relationships and rejects any nested `create`/`update`/
     `connectOrCreate` node — and resolves `connect`/`connectOrCreate` targets from
     the DB — that grants a capability the actor lacks (so connecting an existing
     `DefaultSuperAdminRole` into a lower tier slot is caught too). Root / full
     admin bypass; lookup failures fail closed.
   - ✅ **PR-4c — channel-role authoring (defense-in-depth).**
     `createChannelRoles`/`createModChannelRoles` may author a capability-bearing
     channel role only for a channel the actor owns (or as server admin / root).
     Channel roles carry **no** server-administration capability and cannot reach
     the apex tier; wiring a channel role is already channel-owner-gated. Nested
     role writes in `createChannels`/`updateChannels` need no guard — the actor is
     creating/owns the channel and legitimately defines its roles.
5. **PR-5 (later)** — role-management UI; SuperAdmins section in
   `ServerMembershipEditor`.

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

**Resolved in review (2nd round):**
1. **Align the channel owner tier now** — owners resolve a configurable elevated
   channel role (behavior-preserving fallback to all-perms until seeded), so even
   owners can be made restrictive. Done as part of PR-1.
2. **`emails` enumeration → blanket `deny`** for every role. Only direct database
   access reads addresses; clients use `getOwnEmail`. (Done in PR-1.) No
   `canManageServerMembers` capability is needed for it.
3. **Schema home: extend `ServerRole`** (creative caps) and **`ModServerRole`**
   (destructive: ban/archive/delete) — split by action nature, no dedicated admin
   type. `ServerConfig` holds the per-tier default-role links.
4. **`updateUsers`: self-only.** Users may edit only their own account (with the
   #64 role-assignment block). Editing *other* users is not offered now or
   planned — the only cross-user admin actions are the existing invite flows
   (server admin / channel owner). So there is **no** `canManageServerMembers`
   capability and no admin override on `updateUsers`.
5. **`deleteDiscussionChannels` / `deleteEventChannels`** → destructive caps on
   **`ModServerRole`** (`canRemoveDiscussionChannel` / `canRemoveEventChannel`).
   (Schema added in PR-1; call sites convert in PR-3.)
6. **Roles are permissions-only; display tags derive from membership.** The
   ADMIN/MOD tag must come from the user's relationship to `ServerConfig`
   (`Admins`/`SuperAdmins`) / `Channel` (`Moderators`), **not** from a role flag.
   The seed roles no longer set `showAdminTag` / `showModTag` (PR-2). The legacy
   schema fields are slated for removal in a dedicated follow-up — they are
   currently read by ~5 backend cypher queries and several frontend components,
   so the removal is a coordinated backend+frontend change:
   - Backend: derive the tag in the comment/post queries from membership; drop
     `showAdminTag` (`ServerRole`) and `showModTag` (`ChannelRole`) from the schema
     and `getServerConfigForPermissions`'s fetch.
   - Frontend: have the tag-rendering components/queries read membership-derived
     data instead of the role flag.

Note: items 2 and 4 mean the earlier `canManageServerMembers` capability is
dropped from the taxonomy (§4).

## 9. Testing
- Unit: extend `hasServerPermission.test.ts` / `hasServerModPermission.test.ts`
  for the root override, the admin tier, the suspended-admin path, and the
  generalized default-role fallback (pure-function seams already exist).
- Unit: one test per new capability rule (granted via admin role / via default
  role / denied) following the existing `evaluate*` pattern.
- Integration: extend `authenticatedRoles.test.ts` — a restricted admin passes a
  granted capability and is denied `canManageAdmins`; root passes everything.
