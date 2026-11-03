# Campaign pause/resume concurrency

Pause remains RUNNING → PAUSED; resume remains PAUSED → RUNNING. Both mutations
still require an authenticated caller with server `canManagePlugins` permission.
An initially missing campaign returns `NOT_FOUND`; an initially disallowed state
(including a repeated pause/resume) retains `BAD_USER_INPUT`.

The control repository takes an initial snapshot of node identity, status and
`updatedAt`, then obtains a node write lock in a managed transaction before
checking them again. Changes during that interval return `CONFLICT`, with no
status write. Deletion returns `NOT_FOUND`; deletion/recreation cannot apply an
old request to a replacement node. The timestamp is an optimistic token: normal
generated updates, including progress updates, advance it, so even a change that
returns to the original status can invalidate an overlapping control request.
Clients should refresh before retrying a conflict. This does not introduce a
client-supplied revision or change the public schema.

The lock uses a temporary private property, restoring its prior value within the
transaction. Status is read again after obtaining the lock; assigning status to
itself is unsafe because a value cached before the wait can overwrite the later
value. The lock and conditional generated update share the same transaction.
See Neo4j's [lost-update guidance](https://neo4j.com/docs/operations-manual/current/database-internals/concurrent-data-access/#_lost_updates).

Existing commit/error behavior is retained deliberately: a generated response
field resolver can fail after a successful status write. Such a projection error
is returned after commit. A failed database write cannot commit and is not
reported as success. This slice does not promise that every error means no write.

## Worker behavior is unchanged

The background worker can take a RUNNING snapshot, select a batch, then continue
dispatching that batch after pause succeeds. It can subsequently mark the paused
campaign COMPLETED. An integration test reproduces this using the real worker,
a deterministic paused trigger, the public pause mutation, and real persistence.

Therefore these control-write guards do **not** guarantee that pause immediately
stops new plugin dispatch or that PAUSED remains the final status. Fixing that
requires coordinating worker dispatch/completion with control operations and
choosing the intended behavior:

- Let the selected batch finish and allow completion to supersede pause (current
  behavior), documenting pause as affecting later batch selection.
- Stop additional dispatch after a pause is acknowledged, allow already-started
  work to finish, and decide whether an otherwise-complete paused campaign stays
  PAUSED until resume or becomes COMPLETED.

No worker semantics, creation transactions, plugin effects, credentials, or
production data are changed by this PR. The tests use disposable Neo4j and observe
blocked transactions to control interleavings; they do not rely on sleep timing
to decide which request wins.
