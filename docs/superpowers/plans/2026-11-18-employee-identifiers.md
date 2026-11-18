# Employee identifiers implementation plan

- Add a shared IdentifierField with numeric keyboard, maximum13, optional exact13 pattern, input/paste filtering and leading-zero preservation.
- Use it for both employee identifiers in the shared create/edit form.
- Restore a fresh main backup into isolated QA and verify target before writes.
- Run typecheck, web tests, production build and browser/API round-trip checks including blank, short, overlength, pasted text and edits.
- Publish QA URL and update CURRENT for user acceptance before main deployment.

Follow-up approved by user: share DigitField with phone, set10 digits for phone and13 for both identifiers. Preserve optional phone behavior and check typing, paste, short input, leading-zero round-trip and edit/clear on the same employee-module QA database.
