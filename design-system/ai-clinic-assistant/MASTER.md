# Design System — AI Clinic Assistant (MASTER)

Global source of truth for every screen. A file in `pages/` overrides this one for that page only.
Implemented in `after-visit/tokens.css`. Preview: `after-visit/design-preview.html`.

**Product:** healthcare physical-therapy patient portal: accessible, calm, trustworthy.
**Stack:** plain HTML + CSS + ES-module JavaScript, no build step (matches `after-visit/` and the visit-copilot frontend).
**Users:** PT patients at home (often older, may be in pain, may be using one hand, not tech-comfortable), family helpers, and busy therapists.

## Where this came from

Generated with **ui-ux-pro-max** `--design-system "healthcare physical therapy patient portal accessible calm trustworthy" --density 3`, then verified against this product before persisting:

| Skill output | Decision | Why |
|---|---|---|
| Pattern: Hero + Testimonials + CTA | **Not used.** App pattern instead: card dashboard → task flow | It's a landing-page pattern; this is a logged-in app. |
| Style: Neumorphism (skill flags *accessibility risk: high*) | **Replaced by Inclusive Design** (style search, *risk: low*, best for healthcare) | Soft low-contrast shadows fail older/low-vision users. |
| Colors: calm cyan + health green | **Replaced by the team's palette** (peach, cream, light blue, blue + derived navy ink), table below | Team choice. The skill's cyan/green also failed contrast (white on `#0891B2` 3.68:1). |
| Font: Atkinson Hyperlegible | **Kept** | Designed for low vision; matches the audience. |
| Avoid: neon, heavy motion, purple/pink AI gradients | **Kept** | |
| Charts (`--domain chart` data): Line Chart with Highlights | **Used for therapist review** | Flagged items get shape + text, not color alone; visible table fallback. |

## Principles

1. **One thing per screen, one big action.** Every patient screen has one primary button.
2. **Never rely on color alone.** Status always has an icon and a word: ✓ Good / ~ Fair / ! Poor.
3. **Encouraging, never shaming.** Missed days show nothing negative; completed days show a check. Copy says "Next time, try…", not "Wrong".
4. **Plain language, 6th-grade reading level.** "Raise your arm a little higher", not "Insufficient abduction".
5. **Minimal typing.** Tap, choose, or speak. Every text field has a 🎙 voice option.
6. **Big and forgiving.** Large type, large targets, generous spacing on patient screens.
7. **A little playful.** Calm base, small moments of delight: progress you can see (a path through the week, stepping stones for today's exercises), friendly copy ("One to go!"), soft shapes, and a small confetti moment when a session ends. Never cartoonish, never at the cost of legibility.

## Color tokens (contrast measured, WCAG 2.2)

**Palette (chosen by the team):** peach `#F4BAA3` · cream `#F4F0E2` · light blue `#A6C8E2` · blue `#619DC6`.
All four are light (on white: blue 2.9:1, light blue 1.8:1, peach 1.7:1), so they're used as **backgrounds and fills**, with a deep navy ink **`#0F2B40`** (derived from the blue) for text. Where blue must be a line or link, the darker **`#2C6390`** is used. Status, muted and border shades are derived and measured.

| Token | Light | Dark | Use | Measured |
|---|---|---|---|---|
| `--bg` | `#F4F0E2` cream | `#101F2B` | page | |
| `--surface` | `#FFFFFF` | `#1A2F40` | tiles (hairline border) | |
| `--tile` | `#D3E4F1` pale blue | `#22405A` | the one hero field (Today's exercises) | navy 11.2 : 1, secondary text `#2D4A60` 5.2 : 1 |
| `--fg` | `#0F2B40` navy | `#F4F0E2` cream | body text | 12.8 on cream / 12.1 : 1 |
| `--muted` | `#44586A` | `#C5CFD6` | secondary text | 6.5 on cream / 8.7 : 1 |
| `--primary` | `#619DC6` blue | `#A6C8E2` light blue | primary buttons, progress fill | navy text 5.0 : 1 / dark text 9.6 : 1 |
| `--on-primary` | `#0F2B40` | `#101F2B` | text on primary | |
| `--primary-ink` | `#2C6390` | `#A6C8E2` | links, selected borders, chart target line | 6.4 white · 5.6 cream / 7.9 : 1 |
| `--primary-soft` | `#A6C8E2` light blue | `#2A4A63` | selected day | navy 8.3 : 1 / cream 8.2 : 1 |
| `--accent` | `#F4BAA3` peach | `#F4BAA3` peach | **Start session** CTA only | navy 8.6 : 1 / dark 9.9 : 1 |
| `--accent-ink` | `#B8613F` | `#F4BAA3` | today ring on the week strip | 3.8 : 1 on cream (UI) |
| `--on-accent` | `#0F2B40` | `#101F2B` | text on accent | |
| `--chip` | `#DCE9F4` | `#2A4A63` | provider tags | navy 11.8 : 1 |
| `--border` | `#5F7F99` | `#6F8DA5` | inputs, controls (UI ≥ 3 : 1) | 4.2 white · 3.7 cream / 4.0 : 1 |
| `--divider` | `#E3DDCB` | `#2A4A63` | decorative lines only | |
| `--good` / `--good-bg` | `#2E6A55` / `#E1EFE6` | `#A9E2C6` / `#1F4436` | ✓ good rep, done | 5.4 / 7.4 : 1 |
| `--fair` / `--fair-bg` | `#7A4F00` / `#FBEFC9` | `#F3CB6B` / `#3D3214` | ▲ fair rep | 6.2 / 8.2 : 1 |
| `--poor` / `--poor-bg` | `#A2312A` / `#FCE4DB` | `#FFB4A2` / `#4A2A22` | ✕ poor / flagged rep, errors | 5.7 / 7.5 : 1 |
| `--focus` | `#2C6390` | `#A6C8E2` | focus ring | 3 px ring + 2 px offset |

Never use raw hex in page CSS; always the tokens.

## Typography (v2: lighter, cleaner)

- **Family: Inter** (300, 400, 500, 600), the team's pick: clean, modern and very readable at every size. Fallback `system-ui, -apple-system, "Segoe UI", sans-serif`. The preview page has a switcher to compare Lexend, Atkinson Hyperlegible, Josefin Sans and Roboto.
- **Weights:** body 400 · headings and buttons **500** (no 700 bold) · large numbers **300 light**. Letter-spacing slightly negative on headings (−0.015 em) for a tighter, modern look.
- **Patient base size 18 px**, line-height 1.55. Nothing a patient reads is below 16 px.
- Scale: 16 · **18 body** · 20 · 22 (section titles) · 26–30 (greeting, page title) · 56 (display numbers, light).
- Sentence case everywhere. **No all-caps labels**, and no "·"-separated meta strings; write short phrases instead ("2 sets of 8, about 5 minutes").
- Numbers use `font-variant-numeric: tabular-nums`.
- Respect browser zoom and text size up to 200%.

## Surfaces, spacing, shape (v2)

- **Every section is a card, and cards use the full width** (the team liked how the first version filled the space). Cards sit 16 px apart; on PC the right column stretches to the height of the exercises card, and the Questions card grows to fill it.
- **One colored field per screen:** the pale-blue `--tile` (`#D3E4F1`) is used only for the main thing (Today's exercises). Every other card is white `--surface` with a hairline border.
- **The week is a card** with the streak pill on top and the day circles on a path (done = light-blue fill + check, today = peach-ink ring, upcoming = empty outlined circle).
- **Inside cards, rows are separated by hairlines** (`--hairline`, 12% navy), not nested boxes.
- **Radius hierarchy:** hero field 28 · tiles 20 · inputs 14 · buttons and chips are pills.
- **Elevation:** no card shadows. The only shadow is a soft peach glow under the Start session button.
- **Spacing:** 8 px rhythm. 16 px between dashboard cards, 16–24 px card padding.
- Content width: patient max 640 px (single column on phones); therapist max 1200 px.

## Touch & interaction

- Minimum target **48 × 48 px**; primary actions **56 px tall** pills, full width on phones. ≥ 8 px between targets.
- Every control has hover, pressed (scale 0.98, no layout shift), focus-visible (3 px ring), and disabled states.
- Transitions 150–200 ms ease-out; `prefers-reduced-motion: reduce` turns them off.
- No hover-only information; no gesture-only actions; no time limits on patients.

## Playful elements

- **Week path:** the 7 day circles sit on a line; the line fills blue up to today. A peach **streak pill** with a flame sits above ("4-day streak").
- **Stepping stones:** Today's exercises shows one stone per exercise on a dotted path: done = navy with a check, up next = peach with a dashed ring and its number. Stones hop in one after another on page load (the only automatic motion; off with reduced motion).
- **Icon badges:** 44 px rounded squares in peach-soft `#FBE1D6` or blue-soft `#DCEAF5` with navy icons (11.7 : 1). Each exercise has its own pose icon.
- **Soft shapes:** a peach blob and a blue circle behind the greeting (decorative, `aria-hidden`).
- **Celebration:** "Session done!" with a short confetti drop, a one-line personal best, and the pain check as 0–10 number pills.
- **Copy with warmth:** "One to go!", "You're on a roll", "Your best yet". Never shaming about missed days.

## Icons

- **Inline SVG, Lucide style** (22 px, 1.75 px stroke, round caps), thin to match the lighter type. **No emoji as icons.**
- Decorative icons next to text: `aria-hidden="true"`. Icon-only buttons: `aria-label`.

## Components (in `tokens.css`)

`.btn` pills (`--primary`, `--accent`, `--secondary`, `--ghost`, `--icon`, `--lg` 56 px), `.hero-tile`, `.tile`, `.chip`, `.status` (good/fair/poor with icon + word), `.field`, `.input`, `.week` / `.day` (circle strip: done / today / selected), `.progress`, `.toast`, `.display` (light 56 px numbers).

## Voice & tone

Short, warm, specific. "2 of 3 exercises done today. Nice work." · "Rest day. That's part of the plan." · "Next time, try raising your arm a little higher." · Errors say what to do: "Camera blocked. Tap Allow in the address bar."

## Accessibility baseline (every page)

Semantic landmarks and headings, `lang`, visible labels, keyboard-reachable everything in visual order, `aria-live` for rep feedback and toasts, color never the only signal, 200% zoom without horizontal scroll at 375 px, light and dark both checked.

## Pre-delivery checklist (from ui-ux-pro-max `references/pro-rules.md`)

- [ ] 375 px phone + landscape + tablet + desktop
- [ ] Reduced motion and 200% text size
- [ ] Light **and** dark contrast checked separately
- [ ] Targets ≥ 48 px, nothing under safe areas or fixed bars
- [ ] No emoji icons; one icon family; tokens only
- [ ] Pressed/disabled states clear, no layout shift
- [ ] Screen-reader order = visual order; icon buttons named; decorative icons hidden
- [ ] Labels + hints + inline errors on every field
- [ ] Color is never the only indicator
