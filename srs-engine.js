// srs-engine.js — PharmRevise SRS logic, user profiles, exam scheduler

// ═══════════════════════════════════════════════════════════
// CONSTANTS & STATE
// ═══════════════════════════════════════════════════════════
const USERS_KEY     = 'pharmrevise_users_v1';
const SETTINGS_KEY  = 'pharmrevise_settings_v1'; // per-user, keyed by username
const STREAK_SUFFIX = '_streak';
const CARDS_SUFFIX  = '_cards';
const MODULES       = [...new Set(CARD_DATA.map(c => c.mod))];

let currentUser   = null;
let CARDS         = [];
let activeMod     = 'All';
let activeTopic   = 'All';
let sessionDue    = [];
let sessionIdx    = 0;
let revealed      = false;
let hintShown     = false;
let sessionGraded = false;

// ── Browse search state ───────────────────────────────────
let browseSearch  = '';

// ═══════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════
function today()          { return new Date().toISOString().split('T')[0]; }
function addDays(d, n)    { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().split('T')[0]; }
function daysUntil(d)     { return Math.max(1, Math.ceil((new Date(d) - new Date()) / 864e5)); }

// ═══════════════════════════════════════════════════════════
// USER PROFILES
// ═══════════════════════════════════════════════════════════
function getUsers()        { try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; } catch(e) { return []; } }
function saveUsers(users)  { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }

function addUser(name) {
  const users = getUsers();
  if (!users.includes(name)) { users.push(name); saveUsers(users); }
}

function loginAs(name) {
  if (!name.trim()) return;
  name = name.trim();
  addUser(name);
  currentUser = name;
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('nav-user-btn').textContent = name;
  document.getElementById('nav-user-btn').style.display = 'inline-block';
  CARDS = loadCards();
  renderPills();
  renderStudy();
  renderStreak();
  updateExamBanner();
}

function showLogin() {
  const overlay = document.getElementById('login-overlay');
  overlay.style.display = 'flex';
  const users = getUsers();
  const list = document.getElementById('login-user-list');
  if (users.length) {
    list.innerHTML = '<p>Or continue as:</p>' + users.map(u =>
      `<span class="login-user-chip" onclick="loginAs('${u}')">${u}</span>`
    ).join('');
    list.style.display = 'block';
  } else {
    list.style.display = 'none';
  }
}

function handleLoginKey(e) { if (e.key === 'Enter') { loginAs(document.getElementById('login-name-input').value); } }

// ═══════════════════════════════════════════════════════════
// PER-USER SETTINGS (exam date etc.)
// ═══════════════════════════════════════════════════════════
function userKey(suffix) { return `pharmrevise_${currentUser}${suffix}`; }

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(userKey('_settings'))) || {}; } catch(e) { return {}; }
}

function saveSettings(s) { localStorage.setItem(userKey('_settings'), JSON.stringify(s)); }

function updateExamBanner() {
  const s = loadSettings();
  const banner = document.getElementById('exam-banner');
  if (!banner) return;
  if (!s.examDate) { banner.style.display = 'none'; return; }
  const days = daysUntil(s.examDate);
  const newRemaining = CARDS.filter(c => c.state === 'new' && (activeMod === 'All' || c.mod === activeMod)).length;
  const quota = Math.ceil(newRemaining / days);
  banner.style.display = 'flex';
  document.getElementById('exam-days').textContent = `${days}d to GPhC`;
  document.getElementById('exam-quota').textContent = `~${quota} new cards/day`;
}

function openSettings() {
  const s = loadSettings();
  document.getElementById('settings-modal').style.display = 'flex';
  document.getElementById('exam-date-input').value = s.examDate || '';
}

function saveSettingsFromModal() {
  const s = loadSettings();
  s.examDate = document.getElementById('exam-date-input').value;
  saveSettings(s);
  document.getElementById('settings-modal').style.display = 'none';
  updateExamBanner();
}

function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }

// ═══════════════════════════════════════════════════════════
// CARD PERSISTENCE (per user)
// ═══════════════════════════════════════════════════════════
function loadCards() {
  const saved = localStorage.getItem(userKey(CARDS_SUFFIX));
  if (saved) {
    try {
      const savedData = JSON.parse(saved);
      return CARD_DATA.map((c, i) => {
        const s = savedData[i] || {};
        return { ...c, id: i, state: s.state || 'new', easeFactor: s.ef || 2.5, interval: s.iv || 0, repetitions: s.rp || 0, nextReviewDate: s.nrd || today() };
      });
    } catch(e) {}
  }
  return CARD_DATA.map((c, i) => ({ ...c, id: i, state: 'new', easeFactor: 2.5, interval: 0, repetitions: 0, nextReviewDate: today() }));
}

function saveCards() {
  const data = {};
  CARDS.forEach((c, i) => { data[i] = { state: c.state, ef: c.easeFactor, iv: c.interval, rp: c.repetitions, nrd: c.nextReviewDate }; });
  localStorage.setItem(userKey(CARDS_SUFFIX), JSON.stringify(data));
}

// ═══════════════════════════════════════════════════════════
// STREAK TRACKING (per user)
// ═══════════════════════════════════════════════════════════
function loadStreak() {
  try { return JSON.parse(localStorage.getItem(userKey(STREAK_SUFFIX))) || { count: 0, lastStudy: '', history: [] }; }
  catch(e) { return { count: 0, lastStudy: '', history: [] }; }
}

function saveStreak(s) { localStorage.setItem(userKey(STREAK_SUFFIX), JSON.stringify(s)); }

function updateStreak() {
  const s = loadStreak();
  const td = today();
  if (s.lastStudy === td) return s;
  const yesterday = addDays(td, -1);
  s.count = s.lastStudy === yesterday ? s.count + 1 : 1;
  s.lastStudy = td;
  if (!s.history) s.history = [];
  s.history.push(td);
  if (s.history.length > 7) s.history = s.history.slice(-7);
  saveStreak(s);
  return s;
}

// ═══════════════════════════════════════════════════════════
// SM-2 ALGORITHM
// ═══════════════════════════════════════════════════════════
function gradeCard(card, g) {
  if (g === 0) {
    card.repetitions = 0; card.interval = 1; card.state = 'learning';
  } else if (g === 1) {
    card.interval = Math.max(1, Math.floor(card.interval * 1.2));
    card.state = card.interval >= 7 ? 'mastered' : 'learning';
  } else if (g === 2) {
    card.interval = card.repetitions === 0 ? 1 : card.repetitions === 1 ? 3 : Math.round(card.interval * card.easeFactor);
    card.easeFactor = Math.max(1.3, card.easeFactor + 0.1);
    card.repetitions++;
    card.state = card.interval >= 14 ? 'mastered' : 'learning';
  } else {
    card.interval = card.repetitions === 0 ? 4 : Math.round(card.interval * (card.easeFactor + 0.15));
    card.easeFactor += 0.15;
    card.repetitions++;
    card.state = 'mastered';
  }
  card.nextReviewDate = addDays(today(), card.interval);
  saveCards();
}

// ═══════════════════════════════════════════════════════════
// STUDY PAGE
// ═══════════════════════════════════════════════════════════
function getDue() {
  const td = today();
  return CARDS.filter(c => (activeMod === 'All' || c.mod === activeMod) && c.nextReviewDate <= td);
}

function updateStats() {
  const sub = activeMod === 'All' ? CARDS : CARDS.filter(c => c.mod === activeMod);
  document.getElementById('cnt-new').textContent      = sub.filter(c => c.state === 'new').length;
  document.getElementById('cnt-learning').textContent = sub.filter(c => c.state === 'learning').length;
  document.getElementById('cnt-mastered').textContent = sub.filter(c => c.state === 'mastered').length;
  document.getElementById('cnt-due').textContent      = getDue().length;
  const pct = Math.round(sub.filter(c => c.state === 'mastered').length / sub.length * 100);
  document.getElementById('prog-fill').style.width = pct + '%';
}

function renderPills() {
  document.getElementById('mod-pills').innerHTML =
    ['All', ...MODULES].map(m =>
      `<span class="pill${activeMod === m ? ' active' : ''}" onclick="setMod('${m}')">${m} <span class="pill-count">${m === 'All' ? CARDS.length : CARDS.filter(c => c.mod === m).length}</span></span>`
    ).join('');
}

function setMod(m) { activeMod = m; renderPills(); renderStudy(); updateExamBanner(); }

function renderStreak() {
  const s = loadStreak();
  document.getElementById('streak-text').textContent = s.count + ' day streak';
  const td = today();
  document.getElementById('streak-sub').textContent = s.lastStudy === td ? 'Studied today ✓' : 'Study today to keep your streak!';
  const last7 = [];
  for (let i = 6; i >= 0; i--) last7.push(addDays(td, -i));
  document.getElementById('streak-dots').innerHTML =
    last7.map(d => `<div class="dot${(s.history || []).includes(d) ? ' active' : ''}"></div>`).join('');
}

function renderStudy() {
  updateStats();
  sessionDue = getDue();
  if (!sessionDue.length) {
    document.getElementById('study-area').innerHTML = `
      <div class="done-state">
        <div class="done-icon">✓</div>
        <h2>All caught up!</h2>
        <p>No cards due${activeMod !== 'All' ? ' in ' + activeMod : ''} right now. Come back later!</p>
        <button class="btn-primary" onclick="renderStudy()">Check again</button>
      </div>`;
    return;
  }
  sessionIdx = 0;
  showCard();
}

function showCard() {
  updateStats();
  if (sessionIdx >= sessionDue.length) {
    if (!sessionGraded) { updateStreak(); renderStreak(); sessionGraded = true; }
    document.getElementById('study-area').innerHTML = `
      <div class="done-state">
        <div class="done-icon">🎯</div>
        <h2>Session complete!</h2>
        <p>Reviewed ${sessionDue.length} card${sessionDue.length !== 1 ? 's' : ''}. Keep it up!</p>
        <button class="btn-primary" onclick="renderStudy()">Check for more</button>
      </div>`;
    return;
  }
  sessionGraded = false;
  const c = sessionDue[sessionIdx];
  revealed = false; hintShown = false;
  const badge = c.state === 'new' ? 'state-new' : c.state === 'learning' ? 'state-learning' : 'state-mastered';
  document.getElementById('study-area').innerHTML = `
    <div class="card-area">
      <div class="card-header">
        <span class="card-progress-text">${sessionIdx + 1} / ${sessionDue.length}</span>
        <span class="state-badge ${badge}">${c.state}</span>
      </div>
      <div class="flashcard" id="fc" onclick="revealCard()">
        <div class="card-meta">${c.mod} · ${c.top}</div>
        <div class="card-q">${c.q}</div>
        <div id="card-ans" style="display:none"><hr class="card-divider"><div class="card-a">${c.a.replace(/\n/g,'<br>')}</div></div>
      </div>
      <div class="hint-box" id="hint-box">${c.hint}</div>
      <p class="tap-hint" id="tap-hint">Tap card to reveal answer</p>
      <div id="grade-area" style="display:none">
        <div class="grade-row">
          <button class="grade-btn gb-again" onclick="submitGrade(0)">Again<small>&lt;1d</small></button>
          <button class="grade-btn gb-hard"  onclick="submitGrade(1)">Hard<small>~1d</small></button>
          <button class="grade-btn gb-good"  onclick="submitGrade(2)">Good<small>3d+</small></button>
          <button class="grade-btn gb-easy"  onclick="submitGrade(3)">Easy<small>4d+</small></button>
        </div>
        <div class="action-row">
          <button class="action-btn" onclick="toggleHint()">Show hint</button>
          <button class="action-btn tutor-btn" onclick="askTutor()">Ask tutor ↗</button>
        </div>
      </div>
    </div>`;
}

function revealCard() {
  if (revealed) return;
  revealed = true;
  document.getElementById('card-ans').style.display = 'block';
  document.getElementById('tap-hint').style.display = 'none';
  document.getElementById('grade-area').style.display = 'block';
}

function toggleHint() {
  hintShown = !hintShown;
  document.getElementById('hint-box').classList.toggle('show', hintShown);
}

function submitGrade(g) { gradeCard(sessionDue[sessionIdx], g); sessionIdx++; showCard(); }

function askTutor() {
  const c = sessionDue[sessionIdx];
  const q = encodeURIComponent(`I'm studying for my MPharm GPhC registration assessment and I'm struggling with this question:\n\nModule: ${c.mod} | Topic: ${c.top}\nQuestion: ${c.q}\n\nPlease explain in detail, covering: mechanism of action, clinical relevance, key interactions or monitoring, and suggest a mnemonic to help me remember it.`);
  window.open(`https://claude.ai/new?q=${q}`, '_blank');
}

// ═══════════════════════════════════════════════════════════
// BROWSE PAGE
// ═══════════════════════════════════════════════════════════
function renderBrowse() {
  const topics = [...new Set(CARDS.map(c => c.top))].sort();
  document.getElementById('browse-filters').innerHTML =
    ['All', ...topics].map(tp =>
      `<button class="filter-btn${activeTopic === tp ? ' active' : ''}" onclick="setTopic('${tp}')">${tp}</button>`
    ).join('');

  let filtered = activeTopic === 'All' ? CARDS : CARDS.filter(c => c.top === activeTopic);

  // Search filter
  if (browseSearch.trim()) {
    const q = browseSearch.toLowerCase();
    filtered = filtered.filter(c =>
      c.q.toLowerCase().includes(q) ||
      c.a.toLowerCase().includes(q) ||
      c.t.toLowerCase().includes(q) ||
      c.mod.toLowerCase().includes(q) ||
      c.top.toLowerCase().includes(q) ||
      (c.tags || []).some(tag => tag.toLowerCase().includes(q))
    );
  }

  const resultCount = filtered.length;
  document.getElementById('browse-result-count').textContent =
    browseSearch ? `${resultCount} result${resultCount !== 1 ? 's' : ''}` : '';

  document.getElementById('browse-list').innerHTML = filtered.map(c => `
    <div class="list-item" onclick="browseCard(${c.id})">
      <div class="list-q">${c.q}</div>
      <div class="list-meta">
        <span class="tag">${c.mod}</span>
        <span class="tag">${c.top}</span>
        <span class="tag state-badge ${c.state === 'new' ? 'state-new' : c.state === 'learning' ? 'state-learning' : 'state-mastered'}" style="border:none;">${c.state}</span>
        ${c.interval > 0 ? `<span class="tag" style="color:var(--text3)">Next: ${c.nextReviewDate}</span>` : ''}
      </div>
    </div>`).join('');
}

function onBrowseSearch(val) {
  browseSearch = val;
  renderBrowse();
}

function setTopic(t) { activeTopic = t; renderBrowse(); }

function browseCard(id) {
  const c = CARDS[id];
  const q = encodeURIComponent(`Give me a detailed MPharm revision explanation:\nModule: ${c.mod} | Topic: ${c.top}\nQuestion: ${c.q}\n\nInclude mechanism, clinical relevance, interactions/monitoring, and a mnemonic.`);
  window.open(`https://claude.ai/new?q=${q}`, '_blank');
}

// ═══════════════════════════════════════════════════════════
// STATS PAGE
// ═══════════════════════════════════════════════════════════
function renderStatsPage() {
  const total    = CARDS.length;
  const mastered = CARDS.filter(c => c.state === 'mastered').length;
  const learning = CARDS.filter(c => c.state === 'learning').length;
  const pct      = Math.round(mastered / total * 100);
  document.getElementById('s-total').textContent    = total;
  document.getElementById('s-mastered').textContent = mastered;
  document.getElementById('s-learning').textContent = learning;
  document.getElementById('s-pct').textContent      = pct + '%';

  document.getElementById('module-progress').innerHTML = MODULES.map(m => {
    const sub = CARDS.filter(c => c.mod === m);
    const mas = sub.filter(c => c.state === 'mastered').length;
    const lrn = sub.filter(c => c.state === 'learning').length;
    const nw  = sub.filter(c => c.state === 'new').length;
    const p   = Math.round(mas / sub.length * 100);
    return `<div class="mod-prog-item">
      <div class="mod-prog-header"><span class="mod-prog-name">${m}</span><span class="mod-prog-pct">${p}%</span></div>
      <div class="mod-prog-bar-bg"><div class="mod-prog-bar-fill" style="width:${p}%"></div></div>
      <div class="mod-prog-counts"><span>✓ ${mas} mastered</span><span>◷ ${lrn} learning</span><span>○ ${nw} new</span></div>
    </div>`;
  }).join('');
}

function resetConfirm() {
  if (confirm('Reset all progress for ' + currentUser + '? This cannot be undone.')) {
    localStorage.removeItem(userKey(CARDS_SUFFIX));
    localStorage.removeItem(userKey(STREAK_SUFFIX));
    CARDS = loadCards();
    renderStudy();
    renderStatsPage();
    renderStreak();
    alert('Progress reset.');
  }
}

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
function showPage(p) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + p).classList.add('active');
  const tabs = document.querySelectorAll('.nav-tab');
  const idx  = p === 'study' ? 0 : p === 'browse' ? 1 : 2;
  tabs[idx].classList.add('active');
  if (p === 'browse') renderBrowse();
  if (p === 'stats')  renderStatsPage();
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  showLogin();
});
