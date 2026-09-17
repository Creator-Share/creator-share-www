# Repository Agent Guidance

## Fast follow governance

Before planning or changing this repository, review `FAST_FOLLOWS.md` for items related to the task.

When work changes the state, scope, priority, rationale, trigger, or acceptance evidence of a registered item, update the register in the same pull request.

When new deferred work is discovered, add it with a stable ID instead of burying it in a pull request comment or task transcript.

When an item is completed, keep the row, mark it completed, and add concrete evidence such as a pull request, migration, test, or decision link.

## Advocate Platform architecture

Changes to advocate tenancy, attribution, sponsor identity, payment semantics, domain provisioning, privacy, retention, or audit behavior must remain consistent with `docs/advocate-platform-roadmap.md`.

If implementation requires a different product or security decision, update the architecture document explicitly and obtain approval before making the behavioral change.
