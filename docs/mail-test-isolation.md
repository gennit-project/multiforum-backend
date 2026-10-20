# Mail test isolation investigation (sanitized)

Investigated 2026-10-20 without provider API calls or inherited application configuration in executed tests.

## Evidence

- Source: /tmp/runtime-ledger-commit.log, around lines 5116–5136.
- Timestamp: 2026-10-20T13:46:51.427Z.
- Fixture: services/mail/index.test.ts, "sendEmail returns false when provider is not configured".
- Before-each reset restored ORIGINAL_ENV, including any inherited mail configuration. This fixture called sendEmail without an injected fake provider.
- SDK diagnostic: Resend request path /emails, application_error, statusCode null, message "Unable to fetch data. The request could not be resolved."
- Stack points through resendProvider -> mail service -> this test. The test passed because sendEmail catches provider errors and returns false.
- Fixture recipient, subject and body are hardcoded synthetic example data; sender and API configuration could be inherited. No credential or private sender values are included in this report.
- Installed Resend SDK fetchRequest catches errors encompassing fetch AND successful-response JSON parsing. Therefore the log confirms a native provider request attempt, but does not prove that no bytes were transmitted or that no delivery was accepted. No successful response ID/receipt is recorded here. Transmission and delivery remain unverified. No provider-side verification was performed.

## Fix

Isolated worktree /workspace/ogm-mail-test-boundary, base 658bfe4. Only services/mail/index.test.ts changes.

Clear the five mail environment keys before each test; restore original values only after the suite. Mock native SendGrid.send and Resend.post to deny provider sends before transport. Assert zero native invocations after each test so caught provider errors cannot disguise an unsafe test. Existing configured-provider tests retain injected fake clients. Add a synthetic configuration-clear regression.

This boundary protects this mail test file, not all repository network activity. Sanitized infrastructure-only test launching remains necessary.

## Verification

- Sanitized focused test run with all five synthetic inherited mail settings: 12/12 passed.
- Reviewer independently repeated synthetic run: 12/12 passed.
- Deliberate negative testcopy (removed afterward): omitted fake dependencies for Resend and SendGrid using synthetic settings; both cases failed at native-send attempt assertion, with hard-denied fetch/client.request counters remaining zero. Existing 12 tests passed. Expected result: 14 total, 12 pass, 2 deliberate failures.
- Focused TypeScript check with --types node: passed. Initial focused command omitted explicit Node types; correcting it exposed a HookContext union, fixed with an assertion narrowing to individual test context.
- Focused ESLint and git diff --check passed.
- No full-suite run, commit or publication performed in this worktree.

Patch: /tmp/ogm-mail-boundary.patch. Safe evidence logs: /tmp/mail-boundary-unit.log, /tmp/mail-boundary-negative.log, /tmp/mail-boundary-types.log. Original log remains unchanged and must not be published wholesale.
