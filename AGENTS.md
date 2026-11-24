# LThai project context

At the start of a new chat, read `docs/CURRENT.md` before editing. Read `GLOSSARY.md` for domain terms and `docs/adr/` when an architectural decision is relevant. Treat the code and fresh verification as evidence if a status document is stale.

LThai is an ERP for the tile factory, developed incrementally from shop-floor recording and production into connected departmental workflows. Before adding a module or changing a cross-module workflow, read `docs/erp.md`. In the design, identify shared master data, the source owner, and incoming/outgoing records; reuse existing identities and preserve traceability. Distinguish implemented capabilities from future ERP scope.

Docker (`compose.docker.yaml`) is the primary runtime. The app is on port 3001 and PostgreSQL on 5434. Native PostgreSQL on 5433 is a separate legacy copy backed up by `npm run db:backup`. For Docker backups and restore rehearsals, follow `docs/docker.md#docker-backup`.

When testing a new module:

1. Take a fresh backup of the `lthai` database in `lthai-docker`. Restore it into a separate QA database and point the test app at it. Verify the target before running migrations or tests; test writes belong only in QA.
2. After the user confirms the module and which data to keep, back up the current main database again. Apply the approved code, migrations, and selected data to `lthai`, preserving existing records and changes made since the QA copy. Never restore the whole QA database over `lthai`.
3. Verify the new module and its data in `lthai-docker`. Then remove the module's QA containers and database, retaining the backups and leaving `lthai-docker` as the only LThai stack.

Update `docs/CURRENT.md` when the goal, deployment status, or next action changes so a new chat can resume work.

Keep `.env`, Excel inputs, private staging data and database backups outside Git.

Project skills are in `.agents/skills/`. If there is no Skill invocation tool, open the relevant `SKILL.md` and follow its instructions using the available tools.
