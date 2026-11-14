// Visit Copilot — iPhone web app (no build step).
"use strict";

const LANGS = { en: "English", ko: "한국어 (Korean)", es: "Español", zh: "中文", vi: "Tiếng Việt",
  ar: "العربية", fr: "Français", hi: "हिन्दी", pt: "Português", ru: "Русский", ja: "日本語", tl: "Tagalog" };

// UI strings shown to the patient during the visit (patient's language), fallback English.
const I18N = {
  en: { captions: "Captions", questions: "Questions", notes: "Notes", scan: "Scan paper", speak: "Speak aloud",
        size: "Text size", end: "End visit", listening: "Listening… start talking.", doctor: "Doctor",
        patient: "Patient / family", beforeYouGo: "Before you go — you haven't asked:", showDoctor: "Show doctor",
        open: "Not asked", asked: "Asked", answered: "Answered", diagnosis: "What's going on", meds: "Medicines",
        exercises: "Exercises", todo: "To do & watch for", papers: "Papers you scanned", summary: "Visit summary",
        keyPoints: "Key points", forDoctor: "For the doctor / family", carry: "Questions to ask next time",
        saved: "Saved to your records", nothing: "Notes will appear here as the doctor talks.", reading: "Reading the paper…",
        qForDoctor: "Question for the doctor", writing: "Writing your summary…",
        failed: "The summary couldn't be written right now. Your notes below are complete." },
  ko: { captions: "자막", questions: "질문", notes: "메모", scan: "서류 스캔", speak: "소리로 듣기", size: "글자 크기",
        end: "진료 끝", listening: "듣고 있어요… 말씀하세요.", doctor: "의사", patient: "환자·가족",
        beforeYouGo: "가시기 전에 — 아직 묻지 않은 질문:", showDoctor: "의사에게 보여주기", open: "아직 안 물음",
        asked: "물어봄", answered: "답변 받음", diagnosis: "진단", meds: "약", exercises: "운동",
        todo: "할 일 · 주의 사항", papers: "스캔한 서류", summary: "진료 요약", keyPoints: "핵심 내용",
        forDoctor: "의사·가족용", carry: "다음에 물어볼 질문", saved: "기록에 저장됨",
        nothing: "의사가 말하면 여기에 메모가 나타나요.", reading: "서류를 읽는 중…", qForDoctor: "의사에게 하는 질문",
        writing: "요약을 작성하는 중…", failed: "지금은 요약을 만들 수 없어요. 아래 메모는 모두 저장되어 있어요." },
};

const $ = (s) => document.querySelector(s);
const state = {
  visit: null, ws: null, ctx: null, stream: null, worklet: null, ended: false,
  view: "patient",            // which language is shown large
  speak: false, playAt: 0, fsIdx: 1, startedAt: 0,
  caps: new Map(), notes: null, questions: [], scans: [], seenNotes: 0,
};
const FS = ["1.1rem", "1.3rem", "1.6rem", "2rem", "2.5rem"];

const t = (k) => (I18N[state.visit?.patient_lang] || I18N.en)[k] || I18N.en[k] || k;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Highlight numbers + units so doses never get missed.
const NUM_RE = /(\d+(?:[.,]\d+)?\s?(?:mg|milligrams?|mcg|ml|밀리그램|밀리리터|회|세트|번|times?|sets?|reps?|weeks?|days?|hours?|주|일|시간|초|seconds?)?)/gi;
const hl = (s) => String(s ?? "").split(NUM_RE).map((p, i) => (i % 2 ? `<span class="num">${esc(p)}</span>` : esc(p))).join("");

function toast(msg, ms = 2500) {
  const el = $("#toast"); el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (el.hidden = true), ms);
}
function show(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${screen}`));
}
async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

// ---------------------------------------------------------------- setup screen
function initSetup() {
  for (const [id, def] of [["#doctor-lang", "en"], ["#patient-lang", "ko"]]) {
    const sel = $(id);
    for (const [code, name] of Object.entries(LANGS)) sel.add(new Option(name, code, false, code === def));
  }
  $("#consent").addEventListener("change", (e) => {
    $("#start-btn").disabled = $("#demo-btn").disabled = !e.target.checked;
  });
  $("#load-demo-q").addEventListener("click", async () => {
    const { questions } = await api(`/api/demo-questions?lang=${$("#patient-lang").value}`);
    $("#questions").value = questions.join("\n");
  });
  $("#setup-form").addEventListener("submit", (e) => { e.preventDefault(); start("mic"); });
  $("#demo-btn").addEventListener("click", () => start("demo"));
}

async function start(mode) {
  // iOS: audio must be unlocked inside the tap, before any await.
  state.ctx = new (window.AudioContext || window.webkitAudioContext)();
  state.ctx.resume();
  try {
    if (mode === "mic") {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    }
    state.visit = await api("/api/visits", { method: "POST", body: JSON.stringify({
      doctor_lang: $("#doctor-lang").value, patient_lang: $("#patient-lang").value,
      provider: $("#provider").value.trim(),
      questions: $("#questions").value.split("\n").map((s) => s.trim()).filter(Boolean),
    }) });
  } catch (err) {
    alert(mode === "mic" ? "Couldn't start the microphone. Check Safari's mic permission and that the page is on https://.\n\n" + err.message
                         : "Couldn't start the visit: " + err.message);
    return;
  }
  state.questions = state.visit.questions;
  applyI18n();
  $("#view-toggle").hidden = sameLang();   // nothing to switch when there's one language
  show("visit");
  renderQuestions(); renderNotes();
  state.startedAt = Date.now();
  setInterval(tickTimer, 1000);
  keepAwake();
  connect(mode);
}

function applyI18n() {
  document.documentElement.lang = state.visit.patient_lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $("#reminder-show").textContent = t("showDoctor");
  $("#view-toggle").textContent = state.view === "patient" ? `${LANGS[state.visit.doctor_lang].split(" ")[0]} ⇄` : `${LANGS[state.visit.patient_lang].split(" ")[0]} ⇄`;
}

function tickTimer() {
  const s = Math.floor((Date.now() - state.startedAt) / 1000);
  $("#timer").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

async function keepAwake() {
  try { if ("wakeLock" in navigator) { state.wake = await navigator.wakeLock.request("screen"); } } catch {}
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && !state.ended) {
      try { state.wake = await navigator.wakeLock?.request("screen"); } catch {}
      state.ctx?.resume();
    }
  });
}

// ---------------------------------------------------------------- websocket
function connect(mode) {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/visits/${state.visit.id}`;
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  state.ws = ws;
  ws.onopen = async () => {
    setStatus("Connected");
    if (mode === "mic") {
      ws.send(JSON.stringify({ type: "start_audio" }));
      if (!state.worklet) await startMic();
    } else if (mode === "demo") {
      ws.send(JSON.stringify({ type: "demo" }));
      $("#live-dot").classList.add("on");
    }
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => {
    if (state.ended) return;
    setStatus("Reconnecting…", "warn");
    setTimeout(() => connect(mode === "demo" ? null : "mic-resume"), 1500);
  };
  if (mode === "mic-resume") ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "start_audio" })));
}

async function startMic() {
  await state.ctx.audioWorklet.addModule("pcm-worklet.js");
  const src = state.ctx.createMediaStreamSource(state.stream);
  const node = new AudioWorkletNode(state.ctx, "pcm-downsampler");
  node.port.onmessage = (e) => { if (state.ws?.readyState === 1) state.ws.send(e.data); };
  src.connect(node);   // not connected to destination: we don't want to hear ourselves
  state.worklet = node;
  $("#live-dot").classList.add("on");
}

function setStatus(text, level = "ok") {
  const el = $("#status"); el.textContent = text; el.classList.toggle("warn", level === "warn");
}

function handle(m) {
  switch (m.type) {
    case "hello": break;
    case "status": setStatus(m.text, m.level); break;
    case "caption": renderCaption(m); break;
    case "notes": state.notes = m.notes; state.questions = m.questions; renderNotes(); renderQuestions(); break;
    case "reminder": showReminder(m.questions); break;
    case "audio": if (state.speak) playPcm(m.data); break;
    case "ended": break;
  }
}

// ---------------------------------------------------------------- captions
function capTexts(c) {
  // original is in the speaker's language; translated is in the other one
  const inPatientLang = c.speaker === "doctor" ? c.translated : c.original;
  const inDoctorLang = c.speaker === "doctor" ? c.original : c.translated;
  return state.view === "patient" ? [inPatientLang, inDoctorLang] : [inDoctorLang, inPatientLang];
}
const sameLang = () => state.visit.doctor_lang === state.visit.patient_lang;
function whoLabel(speaker) {
  if (state.view === "patient") return t(speaker);
  return I18N.en[speaker];
}

function renderCaption(c) {
  state.caps.set(c.id, c);
  let li = document.getElementById(`cap-${c.id}`);
  const list = $("#captions");
  const atBottom = list.parentElement.scrollHeight - list.parentElement.scrollTop - list.parentElement.clientHeight < 80;
  if (!li) {
    li = document.createElement("li");
    li.id = `cap-${c.id}`;
    list.appendChild(li);
    $("#captions-empty").hidden = true;
  }
  li.className = `cap ${c.speaker} ${c.final ? "" : "partial"}`;
  let [big, small] = capTexts(c);
  if (sameLang()) small = "";            // same language: captions only, no translation line
  li.innerHTML = `<div class="who">${esc(whoLabel(c.speaker))}</div>
    <p class="big">${hl(big) || "…"}</p>${small ? `<p class="small">${hl(small)}</p>` : ""}`;
  if (atBottom) li.scrollIntoView({ block: "end", behavior: "smooth" });
}
function rerenderCaptions() { for (const c of state.caps.values()) renderCaption(c); }

// ---------------------------------------------------------------- questions
function renderQuestions() {
  const ul = $("#question-list"); ul.innerHTML = "";
  let open = 0;
  for (const q of state.questions) {
    if (q.status === "open") open++;
    const li = document.createElement("li");
    li.className = `q ${q.status}`;
    li.innerHTML = `<div class="qtext">${esc(q.text)}${q.text_doctor_lang ? `<small>${esc(q.text_doctor_lang)}</small>` : ""}</div>
      <span class="pill ${q.status}">${esc(t(q.status))}</span>`;
    li.tabIndex = 0; li.setAttribute("role", "button");
    li.onclick = () => showCard(q);
    ul.appendChild(li);
  }
  $("#q-badge").textContent = open || "";
}

function showCard(q) {
  $("#show-label").textContent = `${t("qForDoctor")} · Question for the doctor`;
  $("#show-big").textContent = q.text_doctor_lang || q.text;
  $("#show-small").textContent = q.text_doctor_lang ? q.text : "";
  $("#show-asked").onclick = async () => {
    $("#show-card").close();
    await api(`/api/visits/${state.visit.id}/questions/${q.id}?status=asked`, { method: "POST" });
  };
  $("#show-card").showModal();
}
$("#show-close").onclick = () => $("#show-card").close();

$("#add-q").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#add-q-input").value.trim(); if (!text) return;
  $("#add-q-input").value = "";
  await api(`/api/visits/${state.visit.id}/questions`, { method: "POST", body: JSON.stringify({ text }) });
});

function showReminder(qs) {
  if (!qs.length) return;
  $("#reminder-title").textContent = t("beforeYouGo");
  $("#reminder-body").textContent = qs.map((q) => q.text).join(" · ");
  $("#reminder").hidden = false;
  $("#reminder-show").onclick = () => { $("#reminder").hidden = true; showCard(qs[0]); };
  chime();
}
$("#reminder-close").onclick = () => ($("#reminder").hidden = true);

function chime() {
  try {
    const o = state.ctx.createOscillator(), g = state.ctx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.0001, state.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, state.ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, state.ctx.currentTime + 0.5);
    o.connect(g).connect(state.ctx.destination); o.start(); o.stop(state.ctx.currentTime + 0.5);
  } catch {}
}

// ---------------------------------------------------------------- notes
function renderNotes() {
  const n = state.notes || {}, el = $("#notes");
  const sec = (title, items) => items.length ? `<div class="nsec"><h3>${esc(title)}</h3>${items.join("")}</div>` : "";
  const docTag = (x) => (x.source === "document" ? `<span class="tag">📄</span>` : "");
  const diag = (n.diagnoses || []).map((d) => `<div class="nitem"><div class="t">${esc(d.name)}</div><div class="d">${esc(d.explanation_patient_lang)}</div></div>`);
  const meds = (n.medications || []).map((m) => `<div class="nitem"><div class="t">${esc(m.name)} ${m.dose ? `<span class="num">${esc(m.dose)}</span>` : ""}${docTag(m)}</div>
      <div>${hl([m.frequency, m.instructions].filter(Boolean).join(" · "))}</div><div class="d">${hl(m.explanation_patient_lang)}</div></div>`);
  const ex = (n.exercises || []).map((x) => `<div class="nitem"><div class="t">${esc(x.name)}</div>
      <div>${hl([x.sets && `${x.sets} sets`, x.reps && `${x.reps} reps`, x.frequency].filter(Boolean).join(" · "))}</div>
      <div class="d">${hl(x.explanation_patient_lang)}</div></div>`);
  const order = { warning_sign: 0, follow_up: 1, test: 2, referral: 3, instruction: 4 };
  const care = [...(n.care_items || [])].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9))
    .map((c) => `<div class="nitem ${esc(c.type)}"><div class="t">${hl(c.text_patient_lang)}${docTag(c)}</div><div class="d">${hl(c.text)}${c.due ? ` · ${esc(c.due)}` : ""}</div></div>`);
  const papers = state.scans.map((s) => `<div class="nitem"><div class="t">📄 ${esc(s.document_type)}</div><div>${hl(s.text_patient_lang)}</div></div>`);
  const html = sec(t("diagnosis"), diag) + sec(t("meds"), meds) + sec(t("exercises"), ex) + sec(t("todo"), care) + sec(t("papers"), papers);
  el.innerHTML = html || `<p class="empty">${esc(t("nothing"))}</p>`;
  const count = diag.length + meds.length + ex.length + care.length + papers.length;
  const onNotes = $("#pane-notes").classList.contains("active");
  if (onNotes) state.seenNotes = count;
  $("#n-badge").textContent = count > state.seenNotes ? count - state.seenNotes : "";
}

// ---------------------------------------------------------------- tabs + tools
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-selected", x === b); });
  document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === `pane-${b.dataset.tab}`));
  if (b.dataset.tab === "notes") renderNotes();
}));

$("#view-toggle").addEventListener("click", () => {
  state.view = state.view === "patient" ? "doctor" : "patient";
  $("#view-toggle").setAttribute("aria-pressed", state.view === "doctor");
  applyI18n(); rerenderCaptions();
});

$("#text-size").addEventListener("click", () => {
  state.fsIdx = (state.fsIdx + 1) % FS.length;
  document.documentElement.style.setProperty("--fs", FS[state.fsIdx]);
});
// long-press text size -> high contrast
$("#text-size").addEventListener("contextmenu", (e) => { e.preventDefault(); document.body.classList.toggle("contrast"); });

$("#speak-toggle").addEventListener("click", () => {
  state.speak = !state.speak;
  $("#speak-toggle").setAttribute("aria-pressed", state.speak);
  state.ctx?.resume();
  if (state.speak) toast("Tip: use earbuds so the mic doesn't hear the translation");
});

function playPcm(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pcm = new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1);
  const buf = state.ctx.createBuffer(1, pcm.length, 24000);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
  const src = state.ctx.createBufferSource(); src.buffer = buf; src.connect(state.ctx.destination);
  state.playAt = Math.max(state.playAt, state.ctx.currentTime + 0.05);
  src.start(state.playAt); state.playAt += buf.duration;
}

$("#scan-input").addEventListener("change", async (e) => {
  const file = e.target.files[0]; if (!file) return;
  toast(t("reading"), 10000);
  const fd = new FormData(); fd.append("file", file);
  try {
    const r = await fetch(`/api/visits/${state.visit.id}/scan`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(await r.text());
    state.scans.push(await r.json());
    renderNotes();
    document.querySelector('.tab[data-tab="notes"]').click();
    toast("✓");
  } catch (err) { toast("Scan failed: " + err.message, 4000); }
  e.target.value = "";
});

$("#end-btn").addEventListener("click", async () => {
  if (!confirm("End the visit and make the summary?")) return;
  state.ended = true;
  state.stream?.getTracks().forEach((tr) => tr.stop());
  state.worklet?.disconnect();
  $("#live-dot").classList.remove("on");
  setStatus("Making summary…");
  try {
    const v = await api(`/api/visits/${state.visit.id}/end`, { method: "POST" });
    renderSummary(v);
  } catch (err) { setStatus("Summary failed: " + err.message, "warn"); state.ended = false; }
  state.ws?.close(); state.wake?.release?.();
});

// ---------------------------------------------------------------- summary
function renderSummary(v) {
  $("#pane-notes").appendChild($("#notes"));   // keep the notes element safe across re-renders
  state.notes = v.notes; state.questions = v.questions;
  const s = v.summary || {};
  const open = v.questions.filter((q) => q.status === "open");
  $("#sum-meta").textContent = [v.provider, new Date(v.started_at * 1000).toLocaleString()].filter(Boolean).join(" · ");
  $("#summary").innerHTML = `
    ${s.key_points_patient_lang ? `<div class="card"><h3>${esc(t("keyPoints"))}</h3><ul class="keypoints">${s.key_points_patient_lang.map((k) => `<li>${hl(k)}</li>`).join("")}</ul></div>` : ""}
    ${s.summary_patient_lang ? `<div class="card"><p>${hl(s.summary_patient_lang)}</p></div>` : ""}
    ${v.summary_pending ? `<div class="card pending" role="status"><span class="spinner" aria-hidden="true"></span> ${esc(t("writing"))}</div>` : ""}
    ${!v.summary && !v.summary_pending && v.summary_failed ? `<div class="card"><p>${esc(t("failed"))}</p></div>` : ""}
    <div id="sum-notes"></div>
    ${open.length ? `<div class="card"><h3>${esc(t("carry"))}</h3><ul class="keypoints">${open.map((q) => `<li>${esc(q.text)}</li>`).join("")}</ul></div>` : ""}
    ${s.summary_doctor_lang ? `<details class="card"><summary><b>${esc(t("forDoctor"))}</b></summary><p>${hl(s.summary_doctor_lang)}</p></details>` : ""}
    ${v.saving ? `<p class="saved">✓ ${esc(t("saved"))}</p>` : ""}`;
  renderNotes();
  $("#sum-notes").appendChild($("#notes"));
  show("summary");
  if (v.summary_pending) {   // summary still being written: check again shortly
    clearTimeout(renderSummary._poll);
    renderSummary._poll = setTimeout(async () => {
      try { renderSummary(await api(`/api/visits/${v.id}`)); } catch { renderSummary(v); }
    }, 2000);
  }
}

initSetup();