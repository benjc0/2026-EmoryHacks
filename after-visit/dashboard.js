// Patient dashboard: greeting, this week, today's exercises, next visit, medicine, questions.
// Layout and look follow design-system/ai-clinic-assistant/pages/patient-dashboard.md and design-preview.html.
// Data: the therapist's plan (js/plan.js), completed sessions and questions saved on this device (js/dashboardData.js).
import { DEMO_PLAN, planExercises } from './js/plan.js';
import {
  readData, writeData, localDate, weekDates, completedIds, streak,
  SAMPLE_CARE, greeting, exerciseHeading, weekLabels, stoneLayout,
} from './js/dashboardData.js';
import { exerciseArt } from './js/exerciseArt.js';

const $ = (s) => document.querySelector(s);
const plan = planExercises();
const today = new Date();
const date = localDate(today);
const therapist = DEMO_PLAN.therapist;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const exIcon = (ex) => (ex.id === 'mini-squat' ? 'squat' : ex.joint.includes('knee') ? 'leg' : 'arm');
const prescription = (ex) => `${ex.reps} reps${ex.mode === 'precise' ? `, aim for ${ex.target}°` : ''}${ex.holdMs ? `, hold ${ex.holdMs / 1000} s` : ''}`;

let data = readData();
let opener = null;

// ---------------------------------------------------------------- storage + notices
function notice(text) {
  $('#notice').textContent = text; $('#notice').hidden = false;
  clearTimeout(notice.timer); notice.timer = setTimeout(() => ($('#notice').hidden = true), 5000);
}
function persist() {
  try { writeData(data); return true; }
  catch { notice('Storage is unavailable. Changes last only in this tab.'); return false; }
}

const remaining = () => plan.filter((e) => !completedIds(data, date).has(e.id));
function session(ids) { if (ids.length) location.href = `session.html?exercises=${encodeURIComponent(ids.join(','))}`; }

// ---------------------------------------------------------------- render
function render() {
  const done = completedIds(data, date);
  const count = plan.filter((e) => done.has(e.id)).length;
  const next = plan.find((e) => !done.has(e.id));

  // greeting
  $('#hello').innerHTML = `${esc(greeting(today.getHours()))}, <span class="nowrap">${esc(SAMPLE_CARE.patient)}</span>`;
  $('#date').textContent = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  // week: streak pill, days on a path that fills up to today
  const days = streak(data, today), labels = weekLabels(days);
  $('#streak').textContent = labels.pill;
  $('#cheer').textContent = labels.cheer;
  const week = weekDates(today), todayIdx = week.findIndex((d) => localDate(d) === date);
  $('#week-fill').style.width = `calc(100% * ${Math.max(0, todayIdx)} / 7)`;
  $('#week').innerHTML = week.map((d) => {
    const key = localDate(d), isToday = key === date, complete = completedIds(data, key).size > 0;
    const long = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    return `<li><button class="day ${complete ? 'day--done' : ''} ${isToday ? 'day--today' : ''}" type="button" data-day="${key}"
      ${isToday ? 'aria-current="date"' : ''} aria-label="${esc(long)}${isToday ? ', today' : ''}${complete ? ', exercises done' : ''}">
      <span class="day__dow day__dow--short" aria-hidden="true">${esc(d.toLocaleDateString(undefined, { weekday: 'narrow' }))}</span>
      <span class="day__dow day__dow--long" aria-hidden="true">${esc(d.toLocaleDateString(undefined, { weekday: 'short' }))}</span>
      <span class="day__dot" aria-hidden="true">${complete ? icon('check') : d.getDate()}</span></button></li>`;
  }).join('');

  // today's exercises
  $('#ex-title').textContent = exerciseHeading(count, plan.length);
  $('#ex-sub').textContent = `${count} of ${plan.length} exercises done today`;
  const { pts, d } = stoneLayout(plan.length);
  $('#stones').innerHTML = `<path d="${d}" fill="none" stroke="var(--border)" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round"/>`
    + plan.map((e, i) => {
      const p = pts[i], delay = `style="animation-delay:${i * 0.25}s"`;
      return done.has(e.id)
        ? `<g class="stone" ${delay}><circle cx="${p.x}" cy="${p.y}" r="22" fill="var(--fg)"/><path d="M${p.x - 9} ${p.y} l6 6 l12 -12" fill="none" stroke="var(--tile)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>`
        : e === next
          ? `<g class="stone" ${delay}><circle cx="${p.x}" cy="${p.y}" r="22" fill="var(--accent)"/><circle cx="${p.x}" cy="${p.y}" r="27" fill="none" stroke="var(--accent-ink)" stroke-width="2" stroke-dasharray="3 5"/><text x="${p.x}" y="${p.y + 6}" text-anchor="middle" font-size="17" font-weight="500" fill="var(--on-accent)">${i + 1}</text></g>`
          : `<g class="stone" ${delay}><circle cx="${p.x}" cy="${p.y}" r="22" fill="var(--surface)" stroke="var(--border)" stroke-width="1.5"/><text x="${p.x}" y="${p.y + 6}" text-anchor="middle" font-size="17" font-weight="500" fill="var(--fg)">${i + 1}</text></g>`;
    }).join('');
  $('#exercises').innerHTML = plan.map((e) => {
    const isDone = done.has(e.id);
    return `<li class="${isDone ? 'done' : ''}">
      <span class="badge-icon ${isDone ? 'badge-icon--white' : 'badge-icon--peach'}">${icon(exIcon(e))}</span>
      <div class="grow"><b>${esc(e.name)}</b><small>${isDone ? 'Done today' : esc(prescription(e))}</small></div>
      ${isDone ? `<span class="tick" role="img" aria-label="Done">${icon('check', 'icon icon--sm')}</span>`
        : `<span class="ring" role="img" aria-label="${e === next ? 'Up next' : 'Not done yet'}"></span>`}</li>`;
  }).join('');
  const quoteFrom = next || plan[plan.length - 1];
  $('#pt-note').textContent = quoteFrom ? `"${quoteFrom.note}" ${therapist}` : '';
  const allDone = count === plan.length;
  $('#start').textContent = allDone ? 'Today’s plan complete' : 'Start session';
  $('#start').disabled = allDone;

  // next visit + medicine
  $('#visit').innerHTML = `${esc(SAMPLE_CARE.nextVisit.when)}<small>${esc(SAMPLE_CARE.nextVisit.who)}</small>`;
  $('#medicine').innerHTML = `${esc(SAMPLE_CARE.medicine.name)}<small>${esc(SAMPLE_CARE.medicine.when)}</small>`;

  // questions: tick a box once you've asked it
  $('#questions').innerHTML = data.questions.length
    ? data.questions.map((q) => `<li class="${q.asked ? 'asked' : ''}">
        <input type="checkbox" data-asked="${esc(q.id)}" ${q.asked ? 'checked' : ''} aria-label="Asked: ${esc(q.text)}">
        <div class="q-text"><span class="q-body">${esc(q.text)}</span><small>${esc(q.for || therapist)}</small></div>
        <button class="btn btn--icon q-remove" type="button" data-remove="${esc(q.id)}" aria-label="Remove question: ${esc(q.text)}">${icon('x', 'icon icon--sm')}</button></li>`).join('')
    : '<li class="q-empty">Anything on your mind? Add it here so you remember to ask.</li>';
}

// ---------------------------------------------------------------- dialogs: plan, day, help
function planView() {
  const left = remaining();
  $('#detail').className = 'plan-view';
  $('#detail-title').textContent = "Today's plan";
  $('#detail-sub').textContent = `${plan.length - left.length} of ${plan.length} done. About ${Math.max(5, plan.length * 5)} minutes. Have a chair or counter nearby for balance.`;
  const done = completedIds(data, date);
  const doneRows = plan.filter((e) => done.has(e.id)).map((e) => `<div class="done-row"><span>${esc(e.name)}</span><span class="status status--good">${icon('check', 'icon icon--sm')}Done</span></div>`).join('');
  const todo = left.map((e) => {
    const previous = data.completions.filter((c) => c.id === e.id && c.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
    return `<article class="plan-ex" aria-labelledby="pl-${e.id}">
      <h3 id="pl-${e.id}">${esc(e.name)}</h3>
      <div class="demo">${exerciseArt(e.id, { label: `${e.name}, shown moving: ${e.instruction}` })}<span class="demo__cap">${icon('play', 'icon icon--sm')}${esc(e.view)}</span></div>
      <dl class="facts">
        <div><dt>Reps</dt><dd class="num">${e.reps}</dd></div>
        <div><dt>${e.mode === 'precise' ? 'Aim for' : e.direction === 'decrease' ? 'Bend to' : 'Reach'}</dt><dd class="num">${e.target}°</dd></div>
        <div><dt>Hold</dt><dd class="num">${e.holdMs ? `${e.holdMs / 1000} seconds` : 'No hold'}</dd></div>
        <div><dt>The camera</dt><dd>${e.mode === 'precise' ? 'Measures your angle' : 'Counts your reps'}</dd></div>
      </dl>
      <div><h4>How to do it</h4><ol><li>${esc(e.setup)}</li><li>${esc(e.instruction)}</li><li>Move slowly, then come back to the start.</li></ol></div>
      <div><h4>A good rep</h4><ul class="checks"><li>${icon('check', 'icon icon--sm')}Reach the target</li><li>${icon('check', 'icon icon--sm')}Slow and steady</li>${e.checks.map((c) => `<li>${icon('check', 'icon icon--sm')}${esc(c.label)}</li>`).join('')}</ul></div>
      <blockquote class="quote">"${esc(e.note)}"<small>${esc(therapist)}</small></blockquote>
      <p class="fine">${previous ? `Last time: ${esc(new Date(`${previous.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' }))}${Number.isFinite(previous.peak) ? `, best ${previous.peak}°` : ''}.` : 'Your first time. A fresh starting point.'}</p>
      <div class="row"><button class="btn btn--secondary" type="button" data-exercise="${e.id}">Start this one</button><button class="btn btn--ghost" type="button" data-ask="${esc(e.name)}">Ask about this</button></div>
    </article>`;
  }).join('');
  $('#detail-body').innerHTML = `<p class="safety">${icon('alert', 'icon icon--sm')}Stop and rest if pain goes above 4 out of 10, or if you feel dizzy.</p>
    ${doneRows ? `<div>${doneRows}</div>` : ''}${todo || '<p>All done for today. Nice work!</p>'}
    <div class="plan-foot"><button class="btn btn--accent btn--lg" type="button" data-session ${left.length ? '' : 'disabled'}>${left.length ? 'Start session' : 'Today’s plan complete'}</button></div>`;
}

function dayView(key) {
  const parsed = new Date(`${key}T12:00:00`);
  if (Number.isNaN(parsed.getTime()) || localDate(parsed) !== key) { location.hash = ''; return false; }
  $('#detail').className = 'day-panel';
  $('#detail-title').textContent = parsed.toLocaleDateString(undefined, { weekday: 'long' });
  $('#detail-sub').textContent = parsed.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  const done = completedIds(data, key);
  $('#detail-body').innerHTML = `
    <section class="day-sec"><h3>Exercises</h3><ul class="day-list">${plan.map((e) => `<li><span class="badge-icon badge-icon--peach">${icon(exIcon(e))}</span><div class="grow">${esc(e.name)}<small>${done.has(e.id) ? 'Done' : esc(prescription(e))}</small></div>${done.has(e.id) ? `<span class="tick" role="img" aria-label="Done">${icon('check', 'icon icon--sm')}</span>` : ''}</li>`).join('')}</ul></section>
    <section class="day-sec"><h3>Medicine</h3><p>${esc(SAMPLE_CARE.medicine.name)}, ${esc(SAMPLE_CARE.medicine.when.toLowerCase())}</p></section>
    <section class="day-sec"><h3>Next visit</h3><p>${esc(SAMPLE_CARE.nextVisit.when)} with ${esc(SAMPLE_CARE.nextVisit.who)}</p></section>
    ${key === date && remaining().length ? '<button class="btn btn--accent btn--lg" type="button" data-session>Start session</button>' : key === date ? '' : '<p class="fine">Exercise sessions start from today’s plan.</p>'}`;
  return true;
}

function helpView() {
  $('#detail').className = '';
  $('#detail-title').textContent = 'A little help';
  $('#detail-sub').textContent = '';
  $('#detail-body').innerHTML = `<p>Tap a day to see its plan. Open today's exercises full screen for the steps, or press Start session to set up your camera.</p>
    <p>Your progress and questions stay in this browser. Nothing is sent to your clinic.</p>
    <p class="fine">This is a sample plan. For care questions, contact your care team. If you need urgent help, call your local emergency number.</p>`;
}

function route() {
  const h = location.hash;
  if (!h) { if ($('#detail').open) $('#detail').close(); return; }
  if (h === '#plan') planView();
  else if (/^#day=\d{4}-\d{2}-\d{2}$/.test(h)) { if (!dayView(h.slice(5))) return; }
  else if (h === '#help') helpView();
  else return;
  if (!$('#detail').open) { opener = document.activeElement; $('#detail').showModal(); }
  $('#close').focus();
}
$('#detail').addEventListener('cancel', (e) => { e.preventDefault(); location.hash = ''; });
$('#detail').addEventListener('close', () => opener?.focus());
$('#close').onclick = () => { location.hash = ''; };
$('#expand').onclick = () => { location.hash = 'plan'; };
$('#start').onclick = () => session(remaining().map((e) => e.id));

// ---------------------------------------------------------------- clicks (days, plan buttons, questions)
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.day) location.hash = `day=${b.dataset.day}`;
  if (b.hasAttribute('data-help')) location.hash = 'help';
  if (b.dataset.exercise) session([b.dataset.exercise]);
  if (b.hasAttribute('data-session')) session(remaining().map((x) => x.id));
  if (b.dataset.ask) { location.hash = ''; $('#question').value = `About ${b.dataset.ask}: `; setTimeout(() => $('#question').focus(), 0); }
  if (b.dataset.remove) {
    data.questions = data.questions.filter((q) => q.id !== b.dataset.remove);
    persist(); render(); $('#question').focus();
  }
});
document.addEventListener('change', (e) => {
  const id = e.target.dataset?.asked;
  if (!id) return;
  data.questions = data.questions.map((q) => (q.id === id ? { ...q, asked: e.target.checked } : q));
  persist(); render();
  document.querySelector(`[data-asked="${CSS.escape(id)}"]`)?.focus();
});

// ---------------------------------------------------------------- add a question (Enter to save, or the mic)
function questionError(msg) {
  $('#question').setAttribute('aria-invalid', msg ? 'true' : 'false');
  $('#question-hint').textContent = msg || 'Press Enter to save. Saved on this device only.';
  $('#question-hint').classList.toggle('err', !!msg);
}
$('#question-form').onsubmit = (e) => {
  e.preventDefault();
  const text = $('#question').value.trim();
  if (!text) { questionError('Type a question first, then press Enter.'); $('#question').focus(); return; }
  data.questions.push({ id: crypto.randomUUID(), text, for: therapist, asked: false });
  const saved = persist();
  render(); $('#question').value = ''; questionError('');
  if (saved) notice('Question saved on this device.');
};
$('#question').oninput = () => questionError('');
const Recog = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Recog) {
  $('#mic').disabled = true;
  $('#mic').setAttribute('aria-label', 'Voice input is unavailable in this browser');
} else {
  $('#mic').onclick = () => {
    const r = new Recog();
    r.lang = navigator.language;
    r.onresult = (e) => { $('#question').value = `${$('#question').value} ${e.results[0][0].transcript}`.slice(0, 500).trim(); questionError(''); };
    r.onerror = () => notice('Voice input could not start. You can type your question.');
    r.onend = () => { $('#mic').disabled = false; };
    try { r.start(); $('#mic').disabled = true; notice('Listening…'); }
    catch { notice('Voice input is unavailable. Please type your question.'); }
  };
}

// ---------------------------------------------------------------- light / dark
let dark = matchMedia('(prefers-color-scheme: dark)').matches;
function theme() {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme').setAttribute('aria-pressed', String(dark));
  $('#theme').setAttribute('aria-label', dark ? 'Light mode' : 'Dark mode');
  $('#theme').innerHTML = icon(dark ? 'sun' : 'moon');
  document.querySelector('meta[name="theme-color"]').content = dark ? '#101F2B' : '#F4F0E2';
}
$('#theme').onclick = () => { dark = !dark; theme(); };
theme();

addEventListener('hashchange', route);
addEventListener('pageshow', () => { data = readData(); render(); });
render();
route();
