---
description: User coding preferences and rules to follow for all changes
---

# Coding Preferences

1. **Confirm before every code change.** Always present your analysis and proposed solution first, then wait for the user's explicit approval before editing any files. This applies to the initial fix AND any follow-on changes discovered during implementation — never chain edits without confirming each one.

2. **Best practice over quick fixes.** Propose robust, production-grade solutions rather than band-aid patches. Think about how established apps solve the same problem.

3. **Confirm the approach.** When multiple solutions exist, lay them out clearly (with tradeoffs) and let the user pick.

4. **Propose long-term solutions.** When fixing a bug or adding a feature, always consider the long-term impact. Present a proper solution that prevents the problem from recurring — not just a quick patch. Include quota/cost/performance implications when relevant.

5. **No silent follow-on fixes.** If you discover an issue while implementing an approved change (e.g. a duplicate INSERT bug, a missing import, a UI inconsistency), describe it and propose the fix — do NOT just silently apply it. The user must approve every code change.

6. **Keep explanations simple and plain.** No jargon-heavy walls of text. Explain what the change does in 2-3 simple sentences. Use plain language, not engineering terminology.
