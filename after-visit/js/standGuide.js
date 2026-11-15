// A small side-on picture of where to stand: the phone at waist height, a dashed view cone, and the person
// far enough back that the cone covers them from head to feet. Used before a session and at each exercise start.
export const STAND_DISTANCE = 'about 6 feet (2 m), or 3 big steps';

export function standGuide({ label = `Stand ${STAND_DISTANCE} from the phone so the camera sees you from head to feet.` } = {}) {
  const line = 'stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"';
  return `<svg class="stand__svg" viewBox="0 0 320 150" role="img" aria-label="${label}">
    <line x1="8" y1="128" x2="312" y2="128" stroke="currentColor" stroke-width="2" opacity=".35"/>
    <path d="M40 78 L262 8 L262 128 Z" fill="currentColor" opacity=".08"/>
    <path d="M40 78 L262 8 M40 78 L262 128" stroke="currentColor" stroke-width="2" stroke-dasharray="5 6" fill="none" opacity=".6"/>
    <rect x="22" y="62" width="16" height="30" rx="4" fill="currentColor"/>
    <path d="M30 92 V128 M20 128 H40" ${line}/>
    <circle cx="262" cy="26" r="10" ${line}/>
    <path d="M262 36 V84 M262 84 L252 126 M262 84 L272 126 M262 46 L246 70 M262 46 L278 70" ${line}/>
    <path d="M42 140 H250" stroke="var(--accent-ink, currentColor)" stroke-width="3" stroke-linecap="round"/>
    <path d="M50 134 L40 140 L50 146 M242 134 L252 140 L242 146" stroke="var(--accent-ink, currentColor)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>`;
}
