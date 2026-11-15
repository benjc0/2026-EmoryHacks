// Plain-language results for a finished session (a record from SessionLog.toRecord()).
// Used by the session page after on-your-own training and by the dashboard after a coach call, so both show the same thing.
// No DOM, so it can be tested in Node.

const counted = (r) => r.counted !== false;   // rushed or out-of-view reps never count

/** "3 min", "under a minute" */
export function minutesText(ms) {
  const m = Math.round((ms || 0) / 60000);
  if (!ms || ms < 45000) return 'under a minute';
  return `${Math.max(1, m)} min`;
}

/** The most common thing to work on across counted reps, in the coach's own words (or null). */
function commonIssue(reps) {
  const tally = new Map();
  for (const r of reps) for (const i of r.issues || []) tally.set(i, (tally.get(i) || 0) + 1);
  let best = null;
  for (const [text, n] of tally) if (!best || n > best.n) best = { text, n };
  return best?.text ?? null;
}

export function sessionResults(record) {
  const exercises = (record?.exercises || []).map((e) => {
    const reps = (e.reps || []).filter(counted);
    const good = reps.filter((r) => r.quality === 'good').length;
    const target = e.repsTarget ?? reps.length;
    const status = e.skipped ? 'skipped' : reps.length && good === reps.length ? 'good' : 'fair';
    return {
      name: e.name,
      status,
      line: e.skipped ? 'Skipped' : `${reps.length} of ${target} reps, ${good} good`,
      tip: e.skipped ? null : commonIssue(reps),
    };
  });

  const t = record?.totals || { reps: 0, good: 0, qualityPct: 0 };
  const all = (record?.exercises || []).flatMap((e) => (e.skipped ? [] : (e.reps || []).filter(counted)));
  const done = exercises.filter((e) => e.status !== 'skipped').length;

  let headline;
  if (!t.reps) headline = 'No reps were counted this time.';
  else if (t.qualityPct >= 80) headline = 'Great work today!';
  else if (t.qualityPct >= 50) headline = 'Good effort. A bit more control next time.';
  else headline = 'You showed up, and that counts. Slow and steady next time.';

  const pain = record?.checkIn?.pain;
  return {
    headline,
    stats: [
      { label: 'Reps counted', value: String(t.reps ?? 0) },
      { label: 'Good form', value: t.reps ? `${t.qualityPct}%` : '–' },
      { label: 'Time', value: minutesText(record?.durationMs) },
    ],
    exercises,
    exercisesDone: done,
    tip: commonIssue(all),
    pain: Number.isFinite(pain) ? `You told us your pain was ${pain} out of 10.` : null,
  };
}

/** The results as HTML: three big numbers, one line per exercise, one tip. `esc` escapes text. */
export function resultsHtml(r, esc) {
  const stats = r.stats.map((s) => `<div class="res-stat"><b class="num">${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join('');
  const rows = r.exercises.map((e) => `<li class="res-row"><span>${esc(e.name)}</span><span class="res-line res-line--${e.status}">${esc(e.line)}</span></li>`).join('');
  return `<p class="res-head">${esc(r.headline)}</p>
    <div class="res-stats">${stats}</div>
    <ul class="res-list">${rows}</ul>
    ${r.tip ? `<p class="res-tip"><b>Next time:</b> ${esc(r.tip)}</p>` : ''}
    ${r.pain ? `<p class="res-pain">${esc(r.pain)}</p>` : ''}`;
}
