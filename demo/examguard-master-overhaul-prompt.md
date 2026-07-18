# ExamGuard AI — Master Overhaul Prompt (for Antigravity)

## Read this first
You have been given four working HTML files: `student-login.html`, `invigilator-login.html`, `student-exam.html`, and `invigilator-dashboard.html`. These are not mood boards or inspiration — they are **literal structural templates**. Copy their layout structure, spacing values, CSS custom properties, font stack, and component patterns directly into the real React app. Where a real screen has more content than the template shows (e.g. Model Benchmarks, Session Reports, the alert modal), extend the *same* system rather than inventing a new one — instructions for those screens are in Section 4 below.

Previous attempts at this redesign produced pages with correct-sounding Tailwind classes but no real layout: text stacked top to bottom, no cards, no split panels, no illustration, default browser input styling. If your output doesn't visually match the reference HTML when opened in a browser, it is not done — go back and fix the structure, not just the class names.

---

## 1. Design system (already implemented in the 4 reference files — reuse exactly)

### Color tokens
Light surfaces (student portal, both login screens):
```
--paper:      #F6F3EC
--card:       #FFFFFF
--line:       #E4DFD2
--ink:        #1C2430
--ink-soft:   #5B6472
--oxford:     #1E3A5F
--oxford-deep:#152C48
--oxford-wash:#EAEFF5
--seal:       #8C2F39
--verdigris:  #4B7A6B
--gold:       #B8912F
```
Dark surfaces (invigilator dashboard only):
```
--midnight:   #10161F
--panel:      #171F2A
--line:       #242C38
--ink:        #E9E4D8
--ink-soft:   #8B94A3
--oxford:     #6E93BE
--seal:       #C1616B
--verdigris:  #7FAE9B
--gold:       #D9B65B
```
Rule: student-facing screens are always light/paper. Invigilator-facing screens are always dark/midnight. Never mix — this contrast is intentional (calm exam-taking vs. control-room monitoring) and is part of the brief, not an inconsistency to "fix."

### Type
- Display serif: **Newsreader**, weight 600 — used only for H1/H2 headlines and question text, never for UI chrome.
- Body/UI sans: **Inter**, weights 400/500/600.
- Data/labels/mono: **IBM Plex Mono** — used for every timestamp, session ID, status label, mono figure, and all-caps eyebrow label (11px, letter-spacing 0.1–0.14em, uppercase).

Load via: `https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap`

### Shape & elevation
- Border radius: 6–8px everywhere. No `rounded-3xl`, no pill-shaped cards.
- No glassmorphism, no `backdrop-blur`, no glow/shadow-colored box-shadows. Cards are flat: 1px solid border in `--line`, solid background, nothing else.
- No looping `animate-pulse` / `animate-ping` on status dots. A status dot is just a small solid circle. Motion is reserved for one-shot transitions only (hover states, alert entering the feed, the seal-stamp settling on confirmation).

### The seal mark
Every screen's header uses the same seal-shaped brand mark (see the inline SVG `path` in any reference file's `.brand svg` — an 8-point scalloped seal outline with "EG" in Newsreader inside it). Reuse this exact SVG path as a component; don't redraw it per screen.

---

## 2. Component patterns to lift directly from the reference files

- **Header bar**: brand mark + wordmark left, contextual controls right, 1px bottom border, sticky top. See `student-exam.html` header and `invigilator-dashboard.html` header for the light/dark variants.
- **Split-screen auth layout**: 46/54 form-panel/art-panel split, illustration panel always solid `--oxford` or `--oxford-deep` with a faint grid background and one custom line-illustration bottom-anchored caption. See both `*-login.html` files.
- **Ledger form fields**: no boxed inputs — underline-only (`border-bottom: 1px solid`), mono type, label as small-caps mono eyebrow above. See `.field` in either login file.
- **MCQ option row**: bordered row with a circular dot indicator, selected state = oxford border + oxford-wash fill + filled dot. See `.option` in `student-exam.html`.
- **Cohort/session card**: flat card with a 3px colored left border keyed to status (verdigris/gold/seal), mono metadata rows, footer row with timestamp + text link. See `.cohort-card` in `invigilator-dashboard.html`.
- **Incident/alert row**: flat card, circular outlined icon badge on the left, student-ID mono chip, headline in Inter 600, confidence in mono. See `.incident` in `invigilator-dashboard.html`.
- **Buttons**: primary = solid `--oxford` background, `--paper` text, 8px radius, no gradient. Secondary/ghost = transparent with `--line` border. No `shadow-lg shadow-indigo-600/20` treatments anywhere.

---

## 3. Copy rules (apply everywhere, not just login)

- Active voice, no exclamation points on warnings. "Face not visible to camera" not "Security Warning: Face missing from webcam frame!"
- No emoji used as functional icons (🎥 🥇 ⚡ ✓). Use lucide-react icons or the seal-stamp motif instead. (Emoji are fine only where the reference HTML uses them as quick placeholders like 🕒/⏱ — replace those with actual lucide `Clock` icons in the real build.)
- Section labels are short and calm: "Ledger metrics" not "On-Device Metrics", "Active exam cohorts" not "Active Student Cohorts" — title case only for proper headings, sentence case for everything else.
- Remove any visible credential hints (e.g. a login page must never display the actual demo password in the UI).

---

## 4. Extending the system to screens not covered by the 4 reference files

Apply the same tokens/components — here's how each remaining screen maps:

**Model Benchmarks tab**: dark surface (same as dashboard). Comparison table uses hairline row dividers (`--line`) and mono numerals, no zebra striping. The "champion model" callout becomes a card with a `--gold` left border and a small-caps "Recommended" label, dropping the 🥇 emoji. Area charts: single-color line matching the metric's semantic color (accuracy → oxford, latency → seal), fill opacity 8–10%, no gradient glow. Confusion matrix diagonal cells use `--verdigris` background wash instead of indigo.

**Session Reports tab**: dark surface, margin-column layout — a slim left rail (mono: student ID, session ID, start/end time) and main content to the right (timeline chart + incident list, same `.incident` card pattern as Live Monitor).

**Alert detail modal**: flat `--panel` surface, 1px `--line` border, no blur backdrop beyond a plain 60% `--midnight` scrim. "Confirm violation" button = solid `--seal`. "Dismiss" = ghost/outline. Confirmed/dismissed status renders as a small filled or outlined seal-stamp icon, not a colored text pill.

**Student submission-confirmation screen**: light surface, centered card, the seal-stamp icon (filled, `--oxford` line color) replaces the generic green checkmark, with a single one-shot settle animation on mount — no looping pulse.

**Print stylesheet**: update color overrides to reference the new light-mode tokens instead of the old slate/indigo hex values; keep all other print rules (hide nav/buttons, single-column flow) as-is.

---

## 5. What must NOT change

All React state, WebSocket message handling, REST calls, ONNX/MediaPipe logic, and TypeScript interfaces (`Question`, `ActiveSession`, `AlertPayload`, `HistoricalReport`, `BenchmarkModel`) stay exactly as they are. This is a restyle of markup, CSS, and copy strings only — no behavioral changes, no renamed props, no altered data shapes.

## 6. Definition of done

Open every screen in a browser and compare it side-by-side against the matching reference HTML file (or, for extended screens, against Section 4's description). If a screen doesn't have real cards, real spacing, real type hierarchy, and the correct light/dark surface for its audience, it's not done — go fix the actual layout, not the class list.
