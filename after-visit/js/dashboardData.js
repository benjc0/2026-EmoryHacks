export const DATA_KEY = 'after-visit-dashboard-v1';
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function weekDates(today = new Date()) {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  monday.setDate(monday.getDate() - (monday.getDay()+6)%7);
  return Array.from({length:7}, (_,i) => { const d = new Date(monday); d.setDate(d.getDate()+i); return d; });
}
export function readData(storage) {
  try {
    storage ??= globalThis.localStorage;
    const v = JSON.parse(storage.getItem(DATA_KEY));
    return { questions: Array.isArray(v?.questions) ? v.questions.filter(q=>typeof q?.text==='string' && typeof q.id==='string') : [], completions: Array.isArray(v?.completions) ? v.completions.filter(c=>typeof c?.date==='string' && typeof c.id==='string') : [] };
  } catch { return {questions:[], completions:[]}; }
}
export function writeData(value, storage = globalThis.localStorage) { storage.setItem(DATA_KEY, JSON.stringify(value)); }
export const completedIds = (data, date) => new Set(data.completions.filter(c=>c.date===date).map(c=>c.id));
export function streak(data, today = new Date()) {
  const days = new Set(data.completions.map(c=>c.date)); const d = new Date(today); let n=0;
  if (!days.has(localDate(d))) d.setDate(d.getDate()-1);
  while (days.has(localDate(d))) { n++; d.setDate(d.getDate()-1); }
  return n;
}
// The sample care plan's visit and medicine (the dashboard design's content). One place to swap in real data
// from the During Visit summary later.
export const SAMPLE_CARE = {
  patient: 'Min-jun',
  nextVisit: { when: 'Tuesday, 2:30', who: 'Sam Rivera, PT' },
  medicine: { name: 'Meloxicam', when: 'With dinner' },
};

/** "Good morning" / "Good afternoon" / "Good evening" for an hour 0-23. */
export const greeting = (hour) => (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');

/** The exercises card heading: encouraging, never shaming. */
export function exerciseHeading(done, total) {
  if (total && done >= total) return 'All done today!';
  if (total - done === 1) return 'One to go!';
  if (done === 0) return 'Ready when you are';
  return 'Nice progress';
}

/** The week card's two labels: the streak pill and the line beside it. */
export function weekLabels(days) {
  if (days >= 3) return { pill: `${days}-day streak`, cheer: "You're on a roll" };
  if (days > 0) return { pill: `${days}-day streak`, cheer: 'Keep it going' };
  return { pill: 'Start a streak today', cheer: 'Every day counts' };
}

/**
 * Stepping-stone positions on the dotted path (viewBox 320 x 84), one per exercise, plus the SVG path through them.
 * Matches the design's three-stone curve and spreads any number of stones along it.
 */
export function stoneLayout(n) {
  const xs = n <= 1 ? [44] : Array.from({ length: n }, (_, i) => Math.round(44 + (232 * i) / (n - 1)));
  const pts = xs.map((x, i) => ({ x, y: i % 2 ? 40 : (i === 0 ? 52 : 34) }));
  let d = pts.length ? `M${pts[0].x} ${pts[0].y}` : '';
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], mx = (a.x + b.x) / 2;
    d += ` C ${Math.round(mx - (b.x - a.x) * 0.15)} ${i % 2 ? 10 : 74}, ${Math.round(mx + (b.x - a.x) * 0.15)} ${i % 2 ? 10 : 74}, ${b.x} ${b.y}`;
  }
  return { pts, d };
}

export function recordCompletion(data, session) {
  if (session.summary.totalReps < session.reps_target) return data;
  const date=localDate(new Date(session.recorded_at));
  return {...data, completions:[...data.completions.filter(c=>!(c.date===date && c.id===session.exercise_id)), {id:session.exercise_id,date,peak:session.summary.bestPeakAngle}]};
}
