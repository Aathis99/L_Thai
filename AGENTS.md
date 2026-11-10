# LThai project context

At the start of a new chat, read `docs/CURRENT.md` before editing. Read `GLOSSARY.md` for domain terms and `docs/adr/` when an architectural decision is relevant. Treat the code and fresh verification as evidence if a status document is stale.

Docker (`compose.docker.yaml`) is the primary runtime on both Windows computers. The app is on port 3001 and PostgreSQL on 5434. Native PostgreSQL on 5433 is a separate legacy copy; `npm run db:backup` backs up that copy, not Docker.

When the user asks to switch computers, send work, or receive work, follow `docs/cross-machine-guide.md`. Before sending, update `docs/CURRENT.md` with the current goal, decisions, changed files, tests actually run, remaining work and next action. Review Git changes, commit/push the work, then use the handoff CLI. Report the transfer folder and remind the user to wait for OneDrive upload completion. A script cannot infer or replace the AI's work summary.

Receive must validate the exact Git commit and checksums, check for unsent destination changes, and create a destination backup before replacing data. Use a separate test database for restore rehearsals. Keep `.env`, Excel inputs, private staging data and database backups outside Git.

Project skills travel under `.agents/skills/`. If there is no Skill invocation tool, open the relevant `SKILL.md` and follow its instructions using the available tools. Global plugins, authentication and Codex chat history require their own setup; the portable source of work context is the repository documentation.
