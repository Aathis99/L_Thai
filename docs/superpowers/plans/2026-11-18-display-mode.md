# Display mode implementation plan

**Goal** Implement the approved global light/dark design in the current checkout.

**Architecture** Root bootstrap restores the browser preference before paint. A shared toggle updates html[data-theme] and localStorage. Semantic CSS tokens feed Tailwind and existing component styles.

- [x] Add shared theme bootstrap and toggle, including storage failure and cross-tab handling. Integrate workspace and auth headers.
- [x] Add theme.css, Tailwind dark variant and semantic tokens. Migrate existing component colors while preserving light appearance and image colors.
- [x] Run typecheck, web tests and production build. Restore a fresh Docker backup to a separate QA database and start isolated QA API/web.
- [x] Verify persistence, keyboard, mobile layout and representative screens. Update CURRENT with review URL and outstanding acceptance.

Review focus includes initial paint, unavailable storage, cross-tab reset, narrow navbar, status contrast and unmodified chart images. Execute directly in this chat under the user's instruction to proceed. Keep production deployment for module acceptance under AGENTS.md.
