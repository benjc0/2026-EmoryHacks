// Animated drawings of each exercise, so patients see WHAT to do, not just its name.
// Inline SVG (no image or video files), drawn in `currentColor`; the moving body part uses --art-move.
// The movement loops gently (arm lifting, knees bending). With prefers-reduced-motion the loop is off
// (dashboard.css) and the drawing shows the finished movement over a dashed "start here" outline instead.
//
// exerciseArt(id)              -> decorative SVG (aria-hidden), for use next to the exercise name
// exerciseArt(id, { label })   -> SVG with role="img" and that label, for use on its own

const LIMB = 'stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"';
const GHOST = 'class="art__ghost" stroke-width="4" stroke-dasharray="3 7" stroke-linecap="round" fill="none"';
const PROP = 'class="art__prop" stroke-width="4" stroke-linecap="round" fill="none"';
const head = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="9" fill="currentColor"/>`;
const line = (pts, extra = LIMB) => `<polyline points="${pts}" stroke="currentColor" ${extra}/>`;
const moving = (pts) => `<polyline points="${pts}" stroke="var(--art-move, currentColor)" ${LIMB}/>`;

// viewBox 0 0 120 120. `still` = body, `ghost` = start position (dashed), `move` = the animated part.
const ART = {
  // Front view: one arm lifts out to the side, from the hip to above shoulder height.
  'shoulder-abduction': {
    still: head(60, 20) + line('60,30 60,70') + line('44,38 76,38') + line('60,70 50,106') + line('60,70 70,106') + line('44,38 40,66'),
    ghost: line('76,38 80,66', GHOST),
    move: `<g class="art__move art__move--raise" style="transform-origin:76px 38px">${moving('76,38 80,66')}</g>`,
  },
  // Front view: one arm reaches straight up and holds.
  'overhead-stretch': {
    still: head(60, 24) + line('60,34 60,74') + line('44,42 76,42') + line('60,74 50,108') + line('60,74 70,108') + line('44,42 40,70'),
    ghost: line('76,42 80,70', GHOST),
    move: `<g class="art__move art__move--reach" style="transform-origin:76px 42px">${moving('76,42 80,70')}</g>`,
  },
  // Side view, seated: the lower leg straightens forward, then lowers.
  'knee-extension': {
    still: line('34,70 72,70', PROP) + line('36,70 36,106', PROP) + line('70,70 70,106', PROP) + line('36,70 36,32', PROP)
      + head(48, 22) + line('48,32 46,66') + line('48,40 58,62') + line('46,66 78,66'),
    ghost: line('78,66 78,98', GHOST),
    move: `<g class="art__move art__move--kick" style="transform-origin:78px 66px">${moving('78,66 78,98 86,98')}</g>`,
  },
  // Side view: stand tall, sit back into a small squat, stand again (two poses that cross-fade).
  'mini-squat': {
    still: '',
    ghost: `<g class="art__ghost-pose"><circle cx="56" cy="18" r="9" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="3 5"/>${line('56,28 56,64 56,84 56,106 68,106', GHOST)}</g>`,
    move: `<g class="art__pose art__pose--a">${head(56, 18)}${line('56,28 56,64')}${line('56,36 70,48')}${moving('56,64 56,85 56,106 68,106')}</g>`
      + `<g class="art__pose art__pose--b">${head(57, 34)}${line('53,43 46,74')}${line('52,50 74,52')}${moving('46,74 68,86 60,106 72,106')}</g>`,
  },
};

/** Every exercise id that has a drawing. */
export const ART_IDS = Object.keys(ART);

/** SVG markup for an exercise drawing. Unknown ids get a plain standing figure. */
export function exerciseArt(id, { label = '' } = {}) {
  const a = ART[id] ?? { still: head(60, 20) + line('60,30 60,70') + line('60,70 50,106') + line('60,70 70,106') + line('44,38 76,38') + line('44,38 40,66') + line('76,38 80,66'), ghost: '', move: '' };
  const a11y = label ? `role="img" aria-label="${String(label).replace(/[&<>"]/g, '')}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="art__svg" viewBox="0 0 120 120" ${a11y}>${a.ghost}${a.still}${a.move}</svg>`;
}
