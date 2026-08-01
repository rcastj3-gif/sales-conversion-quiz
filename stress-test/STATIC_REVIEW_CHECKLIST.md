# Static Review Checklist (manual, not scripted)

- [x] **GlobalControl API key removed.** `grep -n "GC_CONFIG\|GlobalControl" quiz.html index.html` returns
      nothing — the hardcoded key and `sendToGlobalControl()` are gone, replaced by `sendToSupabase()`
      calling the `sales-quiz-submit` edge function (no client secret required, matching the
      `verify_jwt:false` pattern used by other public-facing functions in this Supabase project).
- [x] **`quiz.json` is unused/dead config.** Nothing in `quiz.html`'s inline script fetches or imports
      `quiz.json`, `sequences.json`, or `automations.json`. The live question set and scoring table are
      hardcoded in `quizData` inside `quiz.html`. These files remain as historical documentation only.
- [x] **`automations.json`'s GlobalControl-tag-based rules are now inert.** "Quiz Lead Scoring",
      "Hot Lead Detection", and the three fracture nurture-sequence triggers all depended on tags being
      applied inside GlobalControl when a lead was pushed there. Since no data reaches GlobalControl
      anymore, these rules will never fire for this quiz going forward — a direct, expected consequence
      of dropping GlobalControl, not a bug. Left in place as documentation of what the *old* pipeline did.
- [x] **Q1's "fracture" answer (discovery/objection/followup) is never used in scoring or result
      copy.** `quizData.questions[0].options[*].score` is always `0`, and `option.value` for Q1 is never
      read anywhere in `handleOption`, `showResult`, or the Supabase payload beyond being stored verbatim
      in the `answers` array. The quiz's own premise/name ("Find Your Sales Conversion Fracture") implies
      the fracture type should personalize the result, but it currently doesn't.
- [x] **`viewLeads()` / `exportLeads()` are unauthenticated globals**, callable by anyone with devtools
      open on the page. Blast radius is limited to that visitor's own browser's `localStorage` (not a
      cross-user data leak), so this is low severity — but it's still worth noting as attack surface /
      code smell if the localStorage backup is kept long-term (see stress-test finding on unbounded
      localStorage growth).
