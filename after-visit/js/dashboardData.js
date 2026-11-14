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
export function recordCompletion(data, session) {
  if (session.summary.totalReps < session.reps_target) return data;
  const date=localDate(new Date(session.recorded_at));
  return {...data, completions:[...data.completions.filter(c=>!(c.date===date && c.id===session.exercise_id)), {id:session.exercise_id,date,peak:session.summary.bestPeakAngle}]};
}
