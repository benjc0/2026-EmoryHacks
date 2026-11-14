# Page override — Patient dashboard (phone + PC)

Based on the team's whiteboard sketch. Same sections, same order on every screen size; only the arrangement changes.

**Look (merged v1 + v2):** every section is a full-width card, as in the first version. Inside: the week path with streak pill, stepping stones and "One to go!" in the pale-blue exercises card, and icon badges on every row and tile (see MASTER "Playful elements"). On PC the right column stretches to match the exercises card. Base layout: the week strip sits on the page as circles (no card); Today's exercises is the one pale-blue field with a large light "2 of 3 done"; Appointments and Medicine are small white tiles; Questions is a plain list with hairlines. The ASCII sketches below show placement, not boxes.

## Phone (< 768 px): single column, as sketched

```
┌──────────────────────────────┐
│ Hi, Min-jun        Fri Nov 13 │  greeting + date
│┌────────────────────────────┐│
││ This week       3-day streak││  1. Calendar card
││ M  T  W  T  F  S  S         ││     week strip, ✓ on done days,
││ ✓  ✓  ✓ [F]                 ││     today outlined; tap a day → Day detail
│└────────────────────────────┘│
│┌────────────────────────────┐│
││ Today's exercises  2 of 3 ✓ ││  2. Physical therapy card
││ ▸ Side arm raise  2×10 140° ││     sets, reps, target, therapist note
││ ▸ Mini squat      2×8       ││
││ [      Start session      ] ││     peach CTA, 64 px
│└────────────────────────────┘│
│┌────────────┐┌──────────────┐│
││Appointments││ Medicine     ││  3 + 4. two half-width cards
││Tue 2:30 PT ││ Meloxicam ☐  ││     next appointment · today's doses
│└────────────┘└──────────────┘│
│┌────────────────────────────┐│
││ Questions for next visit    ││  5. Q&C card
││ ☐ Should we ice it? Dr. Lee ││     tag = who it's for
││ [ type…            ] [🎙]   ││
│└────────────────────────────┘│
│                          (?) │  help button, fixed bottom-right, 56 px
└──────────────────────────────┘
```

**Expand button on Today's exercises:** a 48 px icon button (⤢ "maximize") in the card's top-right corner, labeled "Open today's exercises full screen". It opens the **Exercise plan** view below.

**Day detail (right-hand sketch):** a full screen with ← back, the day name ("Monday"), that day's list (exercises, meds, appointments) and a **Start** button if exercises are due. Browser back works (`#day=2026-11-09`).

## PC (≥ 1024 px): two columns, same order

```
┌───────────────────────────────────────────────────────────────┐
│ Hi, Min-jun · Friday, November 13                     (?) Help │
│┌─────────────────────────────────────────────────────────────┐│
││ This week          M ✓  T ✓  W ✓  T ✓  [F]  S  S   streak 4 ││  1. Calendar spans full width
│└─────────────────────────────────────────────────────────────┘│
│┌──────────────────────────────────┐┌─────────────────────────┐│
││ Today's exercises      2 of 3 ✓  ││ Appointments            ││  left 2/3: PT card (the main job)
││ ▸ Side arm raise  2×10  140°      │├─────────────────────────┤│  right 1/3: Appointments,
││ ▸ Mini squat      2×8             ││ Medicine                ││  Medicine, Questions stacked
││ [ Start session ]                 │├─────────────────────────┤│
│└──────────────────────────────────┘│ Questions for next visit││
│                                    └─────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

- **Day detail on PC** opens as a **side panel** on the right (same content as the phone screen), so the week stays visible. Esc or ✕ closes it and focus returns to the day button.
- **Tablet (768–1023 px):** calendar full width, then PT card full width, then Appointments | Medicine side by side, then Questions full width (the phone layout with more room).
- Help: a fixed round button on phone, and a labeled "Help" button in the header on PC.
- The two half-width cards sit side by side only when each gets ≥ 150 px; on narrow phones (or at 200% text size) they stack. Their titles are 18 px.
- Max content width 1200 px; cards keep 24 px padding; patient type stays 18 px on every size.
- DOM order = reading order on every layout (calendar → PT → appointments → medicine → questions), so screen readers and keyboard users get the same sequence as the sketch.

## Exercise plan (full screen, from the ⤢ button)

A full-screen view of today's exercises in more depth. Phone: full screen with ✕ Close top-right. PC: a large centered panel (max 960 px) over a dimmed dashboard. Esc closes it, and focus returns to the ⤢ button. URL `#plan`, so the back button closes it too.

**Top:** "Today's plan" · "2 of 3 done" · about 15 min · equipment: chair, counter for balance.

**One section per exercise, in order (done ones collapsed to a single ✓ line):**

1. **Demo:** a large picture or looping clip (16:9), with "▶ Watch demo" and captions.
2. **Prescription:** sets × reps · target (e.g. "Raise to 140°") · hold time · rest between sets.
3. **How to do it:** 3–4 numbered plain-language steps.
4. **What counts as a good rep:** ✓ reach the target · ✓ slow (about 3 s up, 3 s down) · ✓ elbow straight, body still. This is the same rule the camera scores, so patients know what it's checking.
5. **Camera setup:** "Face the camera" / "Stand side-on", with a small icon of the position, and "Precise angle tracking" or "Rep counting" so patients know which mode runs.
6. **Therapist's note:** in a quote block with the therapist's name ("Slow and controlled. Stop if pain goes above 4/10.").
7. **Last time:** "Tue: 8 of 10 good · best 128°", plus a tiny trend ("up 12° this week"). Encouraging wording only.
8. **Buttons:** "Start this exercise" (secondary) · "Ask a question about this" (adds to the Questions card, tagged for the therapist).

**Bottom (sticky):** one big peach **Start session** button (runs all remaining exercises).

**Safety strip** at the top of the list: "Stop and rest if pain goes above 4/10, or if you feel dizzy."

Cut first if short on time: demo clips (use a still picture), the trend line, "Ask a question about this".
