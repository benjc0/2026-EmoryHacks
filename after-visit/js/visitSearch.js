// "Search your visits": a dashboard card that searches the patient's own visit records with Typesense
// (through the visit server, which keeps the Typesense key). Typo-tolerant, synonyms ("blood thinner" ->
// apixaban), English + Korean, results grouped and highlighted. "Ask" turns the results into a short
// plain-language answer with its sources.
//
// Used by dashboard.js:  const search = mountVisitSearch({ api: API });  search.update(V);
// The card only appears once the visit server has answered (V is not null).

const LABELS = {
  medications: ['Medicines', 'i-pill'],
  exercises: ['Exercises', 'i-squat'],
  care_items: ['Appointments & warnings', 'i-calendar'],
  visit_chunks: ['What was said', 'i-chat'],
  visits: ['Visit summaries', 'i-check'],
};
const ORDER = ['medications', 'exercises', 'care_items', 'visit_chunks', 'visits'];
const SEARCH_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const use = (id) => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;

const CSS = `
.vs-card { grid-column: 1 / -1; display: flex; flex-direction: column; gap: var(--space-2); }
.vs-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; }
.vs-head h2 { margin: 0; font-size: var(--fs-title); }
.vs-form { display: flex; gap: var(--space-1); align-items: center; }
.vs-input-wrap { position: relative; flex: 1; min-width: 0; }
.vs-input-wrap .icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; color: var(--muted); pointer-events: none; }
.vs-input-wrap .input { padding-left: 42px; border-radius: var(--r-pill); }
.vs-chips { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.vs-chips .chip { cursor: pointer; border: 1px solid var(--hairline); background: var(--chip); color: var(--fg); font: inherit; font-size: var(--fs-sm); }
.vs-answer { border-radius: var(--r-tile); background: var(--primary-soft); padding: var(--space-2) var(--space-3); }
.vs-answer p { margin: 0 0 6px; font-size: var(--fs-lg); line-height: 1.45; }
.vs-answer .fine { font-size: var(--fs-sm); color: var(--muted); }
.vs-results { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--space-2); }
.vs-group h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font-size: var(--fs-body); color: var(--muted); font-weight: var(--w-semi); }
.vs-group h3 .icon { width: 18px; height: 18px; }
.vs-group ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.vs-hit { border: 1px solid var(--hairline); border-radius: var(--r-control); padding: 10px 12px; background: var(--surface); }
.vs-hit b { display: block; }
.vs-hit .vs-snip { margin: 4px 0 0; line-height: 1.4; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
.vs-hit .vs-meta { margin: 4px 0 0; font-size: var(--fs-sm); color: var(--muted); }
.vs-hit mark { background: var(--accent-soft); color: inherit; border-radius: 4px; padding: 0 2px; }
.vs-hit.warn { border-color: var(--poor); }
.vs-foot { margin: 0; font-size: var(--fs-sm); color: var(--muted); }
.vs-empty { color: var(--muted); margin: 0; }
@media (max-width: 600px) { .vs-form { flex-wrap: wrap; } .vs-form .vs-input-wrap { flex-basis: 100%; } }
`;

export function mountVisitSearch({ api, host = document.querySelector('main.dash') || document.querySelector('main') }) {
  if (!document.getElementById('vs-style')) {
    const st = document.createElement('style'); st.id = 'vs-style'; st.textContent = CSS; document.head.appendChild(st);
  }
  const card = document.createElement('section');
  card.className = 'tile vs-card'; card.setAttribute('role', 'search'); card.setAttribute('aria-labelledby', 'vs-title'); card.hidden = true;
  card.innerHTML = `
    <div class="vs-head"><h2 id="vs-title">Search your visits</h2><span class="chip" id="vs-engine" hidden></span></div>
    <form class="vs-form" id="vs-form" novalidate>
      <div class="vs-input-wrap">${SEARCH_ICON}
        <label for="vs-q" class="visually-hidden">Search your visit notes, medicines and exercises</label>
        <input class="input" id="vs-q" type="search" maxlength="200" autocomplete="off" enterkeyhint="search"
               placeholder="Try “blood thinner”, “무릎”, or “next appointment”" />
      </div>
      <button type="button" class="btn btn--icon" id="vs-mic" aria-label="Say what you're looking for">${use('i-mic')}</button>
      <button type="button" class="btn btn--secondary" id="vs-ask">Ask</button>
    </form>
    <div class="vs-chips" id="vs-chips" aria-label="Suggestions"></div>
    <div class="vs-answer" id="vs-answer" hidden aria-live="polite"></div>
    <div class="vs-results" id="vs-results" aria-live="polite"></div>
    <p class="vs-foot" id="vs-foot"></p>`;
  host.appendChild(card);

  const $ = (s) => card.querySelector(s);
  const input = $('#vs-q');
  let timer = null, seq = 0;

  function hitHtml(h) {
    const meta = [h.date, h.provider].filter(Boolean).join(' · ');
    const plain = h.detail || h.extra || '';
    const body = h.snippet_html || esc(plain.length > 220 ? plain.slice(0, 220) + '…' : plain);
    const second = h.collection !== 'visit_chunks' && h.extra && h.extra.trim() !== (h.detail || '').trim()
      && !(h.snippet_html || '').includes(esc(h.extra).slice(0, 20))
      ? `<p class="vs-meta">${esc(h.extra)}</p>` : '';
    const warn = h.collection === 'care_items' && /warning/i.test(h.title) ? ' warn' : '';
    return `<li class="vs-hit${warn}"><b>${esc(h.title)}</b><p class="vs-snip">${body}</p>${second}${meta ? `<p class="vs-meta">${esc(meta)}</p>` : ''}</li>`;
  }

  function showEngine(r) {
    const el = $('#vs-engine');
    el.hidden = false;
    el.textContent = r.engine === 'typesense' ? `⚡ Typesense · ${r.took_ms} ms` : 'Offline search';
    $('#vs-foot').textContent = r.engine === 'typesense'
      ? `Searches your own records only. Understands typos, everyday words (“blood thinner” finds apixaban) and Korean${r.semantic ? ', and meaning' : ''}.`
      : 'Typesense is not reachable right now, so this is a simpler search of your saved visits.';
  }

  async function runSearch(q, { keepAnswer = false } = {}) {
    const my = ++seq;
    if (!keepAnswer) $('#vs-answer').hidden = true;
    if (!q.trim()) { $('#vs-results').innerHTML = ''; return; }
    let r;
    try { const res = await fetch(`${api}/search?q=${encodeURIComponent(q)}`); if (!res.ok) throw new Error(res.status); r = await res.json(); }
    catch { if (my === seq) $('#vs-results').innerHTML = '<p class="vs-empty">Search is unavailable right now.</p>'; return; }
    if (my !== seq) return;                              // a newer search already started
    showEngine(r);
    const groups = ORDER.filter((c) => r.groups[c]?.length);
    $('#vs-results').innerHTML = groups.length
      ? groups.map((c) => `<div class="vs-group"><h3>${use(LABELS[c][1])}${LABELS[c][0]}</h3><ul>${r.groups[c].map(hitHtml).join('')}</ul></div>`).join('')
      : `<p class="vs-empty">Nothing found for “${esc(q)}” in your visits. Try another word, or ask your care team.</p>`;
  }

  async function runAsk(q) {
    if (!q.trim()) { input.focus(); return; }
    const box = $('#vs-answer'); box.hidden = false; box.innerHTML = '<p class="fine">Looking through your visits…</p>';
    let a;
    try {
      const res = await fetch(`${api}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) });
      if (!res.ok) throw new Error(res.status); a = await res.json();
    } catch { box.innerHTML = '<p class="fine">Couldn’t reach your visit notes right now.</p>'; return; }
    const src = (a.sources || []).map((s) => `[${s.n}] ${esc(s.title)}${s.date ? ` (${esc(s.date)})` : ''}`).join(' · ');
    box.innerHTML = a.answer
      ? `<p>${esc(a.answer)}</p>${src ? `<p class="fine">From your records: ${src}</p>` : ''}<p class="fine">Based only on your visit notes. If something is unclear, ask your care team.</p>`
      : `<p class="fine">${esc(a.error || 'No answer right now.')}</p>${src ? `<p class="fine">${src}</p>` : ''}`;
    runSearch(q, { keepAnswer: true });                   // show the matching records under the answer
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => runSearch(input.value), 250); });
  $('#vs-form').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); runSearch(input.value); });
  $('#vs-ask').addEventListener('click', () => runAsk(input.value));
  $('#vs-chips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-q]'); if (!b) return;
    input.value = b.dataset.q; b.dataset.ask ? runAsk(b.dataset.q) : runSearch(b.dataset.q);
  });

  const Recog = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recog) $('#vs-mic').hidden = true;
  else $('#vs-mic').addEventListener('click', () => {
    const r = new Recog(); r.lang = document.documentElement.lang || navigator.language;
    r.onresult = (e) => { input.value = e.results[0][0].transcript; runSearch(input.value); };
    try { r.start(); } catch {}
  });

  return {
    /** Show the card once the visit server answered, with suggestions taken from this patient's records. */
    update(V) {
      card.hidden = !V;                                   // hidden only when the visit server isn't reachable
      if (!V) return;
      input.disabled = $('#vs-ask').disabled = !V.has_visits;
      if (!V.has_visits) {                                 // e.g. right after "Reset demo data"
        $('#vs-chips').innerHTML = ''; $('#vs-results').innerHTML = '';
        $('#vs-engine').hidden = true;
        $('#vs-foot').textContent = 'Nothing to search yet. After your next visit, your notes, medicines and exercises will be searchable here.';
        return;
      }
      $('#vs-foot').textContent = '';
      const meds = (V.medications || []).map((m) => m.name).filter(Boolean).slice(0, 2);
      const ex = (V.pt_plan?.exercises || []).map((e) => e.name || e.id).filter(Boolean).slice(0, 1);
      const chips = [
        ...meds, ...ex,
        ...(V.medications || []).some((m) => /apixaban|warfarin|eliquis/i.test(m.name)) ? ['blood thinner'] : [],
        V.patient_lang === 'ko' ? '무릎' : null,
        'next appointment',
      ].filter(Boolean);
      const asks = ['When should I call my doctor?', 'What should I avoid?'];
      $('#vs-chips').innerHTML = [...new Set(chips)].slice(0, 5).map((q) => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')
        + asks.map((q) => `<button type="button" class="chip" data-q="${esc(q)}" data-ask="1">💬 ${esc(q)}</button>`).join('');
    },
  };
}
