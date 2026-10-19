// Friends, Lies & Detectives - front end.
// The browser only displays what the server says this player may see.
(function () {
  'use strict';

  var API = window.FLD_API;
  var CASES = window.FLD_CASES || {};
  var PHASE_NAMES = ['Case briefing', 'First investigation', 'Second investigation', 'Final investigation', 'Final accusation'];
  var AVATARS = ['🕵️', '🎩', '🕶️', '🗝️', '🔍', '🥀', '🖤', '🦊', '🐍', '🌙'];

  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  var uid = null, code = null, S = null, offset = 0;
  var avatar = load('fld_avatar') || AVATARS[0];
  var myScript = null, scriptLoading = false, scriptErr = null, scriptClosedOnce = false;
  var tab = 'case', logTab = 'chat';
  var polling = false, pollTimer = null, tickTimer = null, lastForce = 0, lastStatus = null;
  var lastSeenMsg = 0, accuseStep = 0;
  var sig = {};

  function setHTML(el, key, html) {
    if (sig[key] !== html) { sig[key] = html; el.innerHTML = html; return true; }
    return false;
  }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 3600);
  }
  function setConn(ok) { $('#conn').classList.toggle('hidden', ok); }
  function show(name) {
    ['loading', 'home', 'lobby', 'game', 'result'].forEach(function (n) {
      $('#screen-' + n).classList.toggle('hidden', n !== name);
    });
  }
  function now() { return Date.now() + offset; }
  function fmt(ms) {
    if (ms < 0) ms = 0;
    var s = Math.ceil(ms / 1000), m = Math.floor(s / 60);
    return (m < 10 ? '0' : '') + m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }
  function busy(btn, on) { if (btn) btn.disabled = !!on; }
  function meP() { return S && S.players.filter(function (p) { return p.user_id === uid; })[0]; }
  function pById(id) { return S.players.filter(function (p) { return p.user_id === id; })[0]; }
  function who(id) {
    var p = pById(id); if (!p) return 'Unknown';
    return p.char_name ? p.char_name : p.nickname;
  }
  function caseInfo() { return CASES[S.room.case_id] || { title: S.room.case_id, minPlayers: 5, maxPlayers: 10, description: '', briefing: [] }; }

  /* ---------- boot ---------- */
  async function boot() {
    initHome();
    try { uid = await API.ensureUser(); }
    catch (e) { show('home'); homeError(API.friendly(e)); return; }
    var link = new URLSearchParams(location.search).get('room');
    if (link) { $('#join-code').value = link.toUpperCase(); openPanel('join'); }
    code = load('fld_room');
    if (code) {
      try { await refresh(); startLoops(); return; }
      catch (e) { if (e.code === 'UNKNOWN') { show('home'); homeError('Cannot reach the server. Check your connection and refresh.'); return; } clearRoom(); }
    }
    show('home');
  }

  function homeError(msg) {
    var b = $('#home-error');
    b.textContent = msg || ''; b.classList.toggle('hidden', !msg);
  }

  function initHome() {
    $('#nick').value = load('fld_nick') || '';
    var row = $('#avatar-row');
    row.innerHTML = AVATARS.map(function (a) {
      return '<button type="button" role="radio" aria-checked="' + (a === avatar) + '" data-av="' + esc(a) + '">' + a + '</button>';
    }).join('');
    row.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      avatar = b.getAttribute('data-av'); store('fld_avatar', avatar);
      $$('button', row).forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
    });
    var sel = $('#create-case');
    sel.innerHTML = Object.keys(CASES).map(function (k) {
      var c = CASES[k];
      return '<option value="' + esc(k) + '"' + (c.available ? '' : ' disabled') + '>' + esc(c.title) + (c.available ? '' : ' (coming soon)') + '</option>';
    }).join('');
    $('#btn-show-create').onclick = function () { openPanel('create'); };
    $('#btn-show-join').onclick = function () { openPanel('join'); };
    $('#btn-create').onclick = doCreate;
    $('#btn-join').onclick = doJoin;
    $('#join-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  }
  function openPanel(which) {
    $('#panel-create').classList.toggle('hidden', which !== 'create');
    $('#panel-join').classList.toggle('hidden', which !== 'join');
  }
  function getNick() {
    var n = $('#nick').value.trim();
    if (n.length < 2) { homeError('Choose a name of 2 to 20 characters.'); return null; }
    store('fld_nick', n); homeError(''); return n;
  }

  async function doCreate() {
    var nick = getNick(); if (!nick) return;
    var btn = $('#btn-create'); busy(btn, true);
    try {
      var c = await API.createRoom($('#create-case').value, parseInt($('#create-duration').value, 10), nick, avatar);
      await enter(c);
    } catch (e) { homeError(API.friendly(e)); } finally { busy(btn, false); }
  }
  async function doJoin() {
    var nick = getNick(); if (!nick) return;
    var c = $('#join-code').value.trim().toUpperCase();
    if (!c) { homeError('Enter a room code.'); return; }
    var btn = $('#btn-join'); busy(btn, true);
    try { var r = await API.joinRoom(c, nick, avatar); await enter(r); }
    catch (e) { homeError(API.friendly(e)); } finally { busy(btn, false); }
  }
  async function enter(c) {
    code = c; store('fld_room', c); myScript = null; scriptErr = null; scriptClosedOnce = false; lastStatus = null;
    await refresh(); startLoops();
  }
  function clearRoom() {
    stopLoops(); code = null; S = null; myScript = null; store('fld_room', null);
    history.replaceState(null, '', location.pathname);
    show('home');
  }

  /* ---------- polling ---------- */
  function startLoops() {
    stopLoops();
    pollTimer = setInterval(poll, 2000);
    tickTimer = setInterval(tick, 250);
    document.addEventListener('visibilitychange', onVis);
  }
  function stopLoops() { clearInterval(pollTimer); clearInterval(tickTimer); document.removeEventListener('visibilitychange', onVis); }
  function onVis() { if (!document.hidden) poll(); }

  async function poll() {
    if (polling || !code) return;
    polling = true;
    try { await refresh(); setConn(true); }
    catch (e) {
      if (e.code === 'NOT_IN_ROOM' || e.code === 'ROOM_NOT_FOUND') { toast('You are no longer in that room.'); clearRoom(); }
      else setConn(false);
    } finally { polling = false; }
  }

  async function refresh() {
    var st = await API.getState(code);
    offset = new Date(st.server_now).getTime() - Date.now();
    S = st;
    var status = st.room.status;
    if (status !== lastStatus) {
      if (status === 'lobby') { myScript = null; scriptErr = null; scriptClosedOnce = false; accuseStep = 0; }
      if (status === 'finished') closeModal();
      lastStatus = status;
    }
    route();
  }

  function route() {
    var st = S.room.status;
    if (st === 'lobby') renderLobby();
    else if (st === 'playing') renderGame();
    else renderResult();
  }

  /* ---------- lobby ---------- */
  function renderLobby() {
    show('lobby');
    var r = S.room, isHost = r.host_id === uid, c = caseInfo(), n = S.players.length;
    $('#lobby-code').textContent = r.code;
    $('#lobby-case').textContent = c.title;
    $('#lobby-desc').textContent = c.description || '';
    $('#lobby-slots').textContent = n + ' of ' + c.maxPlayers + ' players joined. Minimum ' + c.minPlayers + ' to start.';
    setHTML($('#lobby-players'), 'lp', S.players.map(function (p) {
      return '<li class="player"><span class="av">' + esc(p.avatar) + '</span>' +
        '<span class="pname">' + esc(p.nickname) + (p.user_id === uid ? ' <em>(you)</em>' : '') + '</span>' +
        (p.is_host ? '<span class="chip gold">HOST</span>' : '') +
        '<span class="chip ' + (p.connected ? 'ok' : 'warn') + '">' + (p.connected ? 'READY' : 'AWAY') + '</span>' +
        (isHost && p.user_id !== uid ? '<button class="btn small ghost" data-act="kick" data-id="' + esc(p.user_id) + '">Remove</button>' : '') +
        '</li>';
    }).join(''));
    $('#host-settings').classList.toggle('hidden', !isHost);
    if (isHost) {
      setIfIdle('#set-duration', String(r.duration_min));
      setIfIdle('#set-qlimit', String(r.question_limit));
      var cb = $('#set-reread'); if (document.activeElement !== cb) cb.checked = !!r.allow_rereading;
    }
    var start = $('#btn-start');
    start.classList.toggle('hidden', !isHost);
    start.disabled = n < c.minPlayers;
    $('#lobby-info').textContent = isHost
      ? (n < c.minPlayers ? 'Waiting for more players. Share the code or invite link.' : 'Everyone ready? Roles are assigned at random when you start.')
      : 'Waiting for the host to start the investigation.';
  }
  function setIfIdle(sel, v) { var el = $(sel); if (document.activeElement !== el) el.value = v; }

  async function saveSettings() {
    try {
      await API.updateRoom(code, parseInt($('#set-duration').value, 10), parseInt($('#set-qlimit').value, 10), $('#set-reread').checked);
      poll();
    } catch (e) { toast(API.friendly(e)); }
  }

  /* ---------- game ---------- */
  function renderGame() {
    show('game');
    var r = S.room, c = caseInfo(), me = meP();
    $('#game-title').textContent = c.title;
    var ph = Math.min(Math.max(r.phase, 1), 5);
    $('#phase-label').textContent = 'Phase ' + ph + ' of 5 · ' + PHASE_NAMES[ph - 1];
    ensureScript();
    renderRole(me);
    setHTML($('#brief'), 'brief', (c.briefing || []).map(function (t) { return '<p>' + esc(t) + '</p>'; }).join(''));
    $('#case-summary').textContent = c.description || '';
    $('#q-counter').textContent = 'Official questions used: ' + S.questions_used + ' of ' + r.question_limit;
    renderPeople();
    renderEvidence();
    renderDetective(me);
    renderQBanner(me);
    renderChat();
    renderLog();
    applyTab();
  }

  async function ensureScript() {
    if (myScript || scriptLoading || scriptErr) return;
    scriptLoading = true;
    try {
      myScript = await API.getScript(code);
      var k = code + '|' + S.room.started_at;
      var seen = null; try { seen = sessionStorage.getItem('fld_shown'); } catch (e) {}
      if (seen !== k) { try { sessionStorage.setItem('fld_shown', k); } catch (e) {} openScript(); }
    } catch (e) { scriptErr = e.code || 'ERR'; }
    finally { scriptLoading = false; renderRole(meP()); }
  }

  function renderRole(me) {
    if (!me) return;
    var locked = S.room.status === 'playing' && !S.room.allow_rereading && scriptClosedOnce;
    var btn;
    if (scriptErr) btn = '<p class="muted small">' + esc(API.friendly({ code: scriptErr })) + '</p>';
    else if (!myScript) btn = '<p class="muted small">Loading your script&hellip;</p>';
    else if (locked) btn = '<p class="muted small">Script locked by the host.</p>';
    else btn = '<button class="btn gold block" data-act="script">Open my private script</button>';
    setHTML($('#role-card'), 'role',
      '<div class="muted small">YOU ARE PLAYING</div>' +
      '<h2 class="title">' + esc(me.char_name || '') + '</h2>' +
      '<div class="muted">' + esc(me.occupation || '') + '</div>' +
      (me.is_detective ? '<p><span class="chip red">THE DETECTIVE</span> Everyone knows this.</p>' : '<p class="small muted">Your role (suspect, witness or something worse) is in your private script.</p>') +
      btn);
  }

  function renderPeople() {
    setHTML($('#people'), 'people', S.players.map(function (p) {
      return '<li class="player"><span class="av">' + esc(p.avatar) + '</span>' +
        '<span class="pname">' + esc(p.char_name || p.nickname) + (p.user_id === uid ? ' <em>(you)</em>' : '') +
        '<small>' + esc(p.occupation || '') + ' · played by ' + esc(p.nickname) + '</small>' +
        '<small>' + esc(p.public_desc || '') + '</small></span>' +
        (p.is_detective ? '<span class="chip red">DETECTIVE</span>' : '') +
        '<span class="dot ' + (p.connected ? 'on' : '') + '" title="' + (p.connected ? 'connected' : 'disconnected') + '"></span></li>';
    }).join(''));
  }

  function renderEvidence() {
    var ev = S.evidence || [];
    setHTML($('#evidence'), 'ev', ev.length ? ev.map(function (e) {
      return '<button class="ev" data-act="ev" data-id="' + esc(e.evidence_id) + '"><span class="id">' + esc(e.evidence_id) + '</span><strong>' + esc(e.title) + '</strong><small>Tap to read</small></button>';
    }).join('') : '<p class="muted small">No evidence yet. The first cards unlock when the briefing ends.</p>');
  }
  function openEvidence(id) {
    var e = (S.evidence || []).filter(function (x) { return x.evidence_id === id; })[0]; if (!e) return;
    openModal('<span class="chip gold">' + esc(e.evidence_id) + '</span><h2 id="modal-title" class="title">' + esc(e.title) + '</h2>' +
      '<p>' + esc(e.description) + '</p>' +
      '<h4>This establishes</h4><p>' + esc(e.establishes) + '</p>' +
      '<h4>This does not establish</h4><p>' + esc(e.not_establishes) + '</p>');
  }

  function openQuestion() {
    if (S.room.status !== 'playing') return null;
    var open = S.questions.filter(function (q) { return !q.released; });
    return open.length ? open[open.length - 1] : null;
  }

  function renderDetective(me) {
    var box = $('#det-controls');
    if (!me || !me.is_detective) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    var r = S.room, open = openQuestion(), left = r.question_limit - S.questions_used, hint = '';
    if (r.phase < 2) hint = 'Questions open when the briefing ends.';
    else if (r.phase > 4) hint = 'Questioning is closed. Submit your accusation.';
    else if (open) hint = 'Wait for the open question to finish.';
    else if (left <= 0) hint = 'You have used all your official questions.';
    $('#det-left').textContent = 'Official questions left: ' + Math.max(left, 0) + ' of ' + r.question_limit + '. Everyone must answer within 30 seconds (60 if you ask everyone).';
    var opts = '<option value="">Everyone (60 seconds)</option>' + S.players.filter(function (p) { return !p.is_detective; }).map(function (p) {
      return '<option value="' + esc(p.user_id) + '">' + esc(p.char_name) + ' (30 seconds)</option>';
    }).join('');
    var sel = $('#q-target'), cur = sel.value;
    if (setHTML(sel, 'qt', opts)) sel.value = cur;
    $('#btn-ask').disabled = !!hint;
    $('#q-body').disabled = !!hint;
    $('#det-hint').textContent = hint;
    $('[data-act=accuse]', box).disabled = r.phase < 2;
  }

  function renderQBanner(me) {
    var box = $('#qbanner'), q = openQuestion();
    if (!q) { box.classList.add('hidden'); sig.qmode = null; return; }
    box.classList.remove('hidden');
    var iAmDet = !!(me && me.is_detective);
    var required = iAmDet ? false : (q.target_user === null || q.target_user === uid);
    var answered = !!q.my_answer;
    var open = new Date(q.deadline_at).getTime() > now();
    var mode = q.id + '|' + (required ? (answered ? 'done' : (open ? 'answer' : 'late')) : 'view');
    if (sig.qmode !== mode) {
      sig.qmode = mode;
      var target = q.target_user === null ? 'Everyone' : esc(who(q.target_user));
      var html = '<div class="qh"><span>Detective question #' + q.seq + '</span><span id="qcount"></span></div>' +
        '<div class="qt">&ldquo;' + esc(q.body) + '&rdquo;</div>' +
        '<div class="small muted">Asked to: ' + target + '</div>';
      if (required && !answered && open) {
        html += '<div class="req">Your answer is required.</div>' +
          '<textarea id="ans-body" rows="2" maxlength="300" placeholder="Type your answer&hellip;"></textarea>' +
          '<button class="btn gold block" id="ans-send">Submit answer</button>';
      } else if (required && answered) {
        html += '<div class="small">Your answer: ' + esc(q.my_answer) + '</div>';
      } else if (required) {
        html += '<div class="small warn">The response window closed before you answered.</div>';
      }
      html += '<div class="chips" id="qstatus"></div>';
      box.innerHTML = html;
      var send = $('#ans-send');
      if (send) send.onclick = function () { submitAnswer(q.id); };
    }
    var chips = (q.statuses || []).map(function (s) {
      var label = { answered: 'Answered', awaiting: 'Awaiting', overdue: 'Overdue', disconnected: 'Disconnected' }[s.status] || s.status;
      var cls = { answered: 'ok', awaiting: '', overdue: 'red', disconnected: 'warn' }[s.status] || '';
      return '<span class="chip ' + cls + '">' + esc(who(s.user_id)) + ': ' + label + '</span>';
    }).join('');
    var qs = $('#qstatus'); if (qs) setHTML(qs, 'qs' + q.id, chips);
  }

  async function submitAnswer(qid) {
    var ta = $('#ans-body'), txt = ta ? ta.value.trim() : '';
    if (!txt) { toast('Write your answer first.'); return; }
    var b = $('#ans-send'); busy(b, true);
    try { await API.answer(qid, txt); await poll(); }
    catch (e) { toast(API.friendly(e)); busy(b, false); poll(); }
  }

  async function askQuestion() {
    var body = $('#q-body').value.trim(), t = $('#q-target').value || null;
    if (body.length < 3) { toast('Type a question first.'); return; }
    var b = $('#btn-ask'); busy(b, true);
    try { await API.ask(code, t, body); $('#q-body').value = ''; await poll(); }
    catch (e) { toast(API.friendly(e)); } finally { busy(b, false); poll(); }
  }

  /* chat */
  function renderChat() {
    var list = $('#chat-list'), msgs = S.messages || [];
    var atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    var html = msgs.length ? msgs.map(function (m) {
      var p = pById(m.user_id), name = p ? (p.char_name || p.nickname) : m.nickname;
      return '<div class="msg' + (m.user_id === uid ? ' mine' : '') + '"><b>' + esc(name) + '</b>' +
        (p && p.char_name ? '<small>(' + esc(p.nickname) + ')</small>' : '') + ' ' + esc(m.body) + '</div>';
    }).join('') : '<p class="muted small">No messages yet. Ask, accuse, defend yourself. Anyone may ignore a question in public chat.</p>';
    if (setHTML(list, 'chat', html) && atBottom) list.scrollTop = list.scrollHeight;
    var last = msgs.length ? msgs[msgs.length - 1].id : 0;
    if (tab === 'chat' && logTab === 'chat') lastSeenMsg = last;
    var narrow = window.matchMedia('(max-width: 959px)').matches;
    $('#chat-dot').classList.toggle('hidden', !(narrow && tab !== 'chat' && last > lastSeenMsg));
  }
  async function sendChat(ev) {
    ev.preventDefault();
    var inp = $('#chat-input'), txt = inp.value.trim(); if (!txt) return;
    inp.value = '';
    try { await API.sendMessage(code, uuid(), txt); await poll(); }
    catch (e) { toast(API.friendly(e)); inp.value = txt; }
  }

  /* question log */
  function renderLog() {
    var qs = S.questions || [];
    var html = qs.length ? qs.slice().reverse().map(function (q) {
      var target = q.target_user === null ? 'Everyone' : who(q.target_user);
      var ans = '';
      if (q.released) {
        var answered = {};
        ans = (q.answers || []).map(function (a) {
          answered[a.user_id] = 1;
          return '<div class="ans"><b>' + esc(who(a.user_id)) + ':</b> ' + esc(a.body) + '</div>';
        }).join('');
        ans += (q.statuses || []).filter(function (s) { return !answered[s.user_id]; }).map(function (s) {
          return '<div class="ans muted"><b>' + esc(who(s.user_id)) + ':</b> no answer (' + esc(s.status) + ')</div>';
        }).join('');
      } else ans = '<div class="ans muted">Answers are hidden until the window closes.</div>';
      return '<div class="qi"><div class="small muted">Question #' + q.seq + ' to ' + esc(target) + '</div><div class="qq">' + esc(q.body) + '</div>' + ans + '</div>';
    }).join('') : '<p class="muted small">The detective has not asked any official questions yet.</p>';
    setHTML($('#qlog'), 'qlog', html);
  }

  /* ---------- modal ---------- */
  function openModal(html) {
    $('#modal-body').innerHTML = html;
    var m = $('#modal'); m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false');
    $('#modal-x').focus();
  }
  function closeModal() {
    var m = $('#modal'); if (m.classList.contains('hidden')) return;
    m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true'); $('#modal-body').innerHTML = '';
    if (myScript && S && S.room.status === 'playing') { scriptClosedOnce = true; renderRole(meP()); }
  }

  function list(a) {
    return a && a.length ? '<ul>' + a.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<p class="muted">Nothing.</p>';
  }
  function openScript() {
    var s = myScript; if (!s) return;
    var id = s.identity || {}, k = s.knows || {}, d = s.disclosure || {};
    function sec(n, t, body) { return '<section class="sec"><h4>Section ' + n + ': ' + t + '</h4>' + body + '</section>'; }
    openModal(
      '<div class="private">PRIVATE. Do not show your screen to anyone.</div>' +
      '<div class="rolebadge" id="modal-title">' + esc(s.role || '') + '</div>' +
      sec(1, 'Your identity',
        '<p><b>' + esc(id.name) + '</b>, ' + esc(id.occupation) + ' (' + esc(id.age_range) + ')</p>' +
        '<p><span class="muted">Relationship to the victim:</span> ' + esc(id.relationship_to_victim) + '</p>' +
        '<p><span class="muted">Relationship to others:</span> ' + esc(id.relationship_to_others) + '</p>') +
      sec(2, 'Your background', '<p>' + esc(s.background) + '</p>') +
      sec(3, 'What you know',
        '<p class="muted small">Seen with your own eyes</p>' + list(k.observed) +
        '<p class="muted small">Told to you</p>' + list(k.told) +
        '<p class="muted small">Your assumptions</p>' + list(k.assumptions) +
        '<p class="muted small">What you do not know</p>' + list(k.unknown)) +
      sec(4, 'Your timeline', list(s.timeline)) +
      sec(5, 'Your secret', '<p>' + esc(s.secret) + '</p>') +
      sec(6, 'Your connection to the crime', '<p>' + esc(s.connection) + '</p>') +
      sec(7, 'How to play your character', list(s.how_to_play)) +
      sec(8, 'Your objective', '<p>' + esc(s.objective) + '</p>') +
      sec(9, 'Information disclosure',
        '<p class="muted small">You can say freely</p>' + list(d.freely) +
        '<p class="muted small">Keep to yourself</p>' + list(d.conceal) +
        '<p class="muted small">You may lie about</p>' + list(d.may_lie) +
        '<p class="muted small">You cannot know</p>' + list(d.cannot_know)) +
      '<p class="muted small">Improvise your own words. This is a guide to what you know and want, not a script to read out.</p>');
  }

  /* ---------- accusation ---------- */
  function openAccuse() {
    accuseStep = 0;
    var opts = S.players.filter(function (p) { return !p.is_detective; }).map(function (p) {
      return '<option value="' + esc(p.char_id) + '">' + esc(p.char_name) + ' - ' + esc(p.occupation) + '</option>';
    }).join('');
    openModal('<h2 id="modal-title" class="title">Final accusation</h2>' +
      '<p class="small muted">You get one accusation. A wrong answer lets the thief win.</p>' +
      '<label for="acc-char">Who took the money?</label><select id="acc-char">' + opts + '</select>' +
      '<label for="acc-why">Your reasoning</label><textarea id="acc-why" rows="4" maxlength="800" placeholder="Explain how you know&hellip;"></textarea>' +
      '<label for="acc-evi">Evidence that supports it (optional)</label><textarea id="acc-evi" rows="2" maxlength="800" placeholder="e.g. CASE01-E01, CASE01-E06"></textarea>' +
      '<div id="acc-err" class="error hidden"></div>' +
      '<button class="btn gold block" id="acc-go">Review accusation</button>');
    $('#acc-go').onclick = accuseGo;
    ['#acc-char', '#acc-why', '#acc-evi'].forEach(function (s) {
      $(s).addEventListener('input', function () { accuseStep = 0; $('#acc-go').textContent = 'Review accusation'; $('#acc-go').className = 'btn gold block'; });
    });
  }
  async function accuseGo() {
    var why = $('#acc-why').value.trim(), err = $('#acc-err');
    if (why.length < 10) { err.textContent = 'Write a fuller explanation first.'; err.classList.remove('hidden'); return; }
    err.classList.add('hidden');
    var btn = $('#acc-go');
    if (accuseStep === 0) {
      accuseStep = 1;
      var nm = $('#acc-char').selectedOptions[0].textContent.split(' - ')[0];
      btn.textContent = 'Confirm: accuse ' + nm + '. This cannot be undone.';
      btn.className = 'btn danger block';
      return;
    }
    busy(btn, true);
    try { await API.accuse(code, $('#acc-char').value, why, $('#acc-evi').value.trim()); closeModal(); await poll(); }
    catch (e) { err.textContent = API.friendly(e); err.classList.remove('hidden'); busy(btn, false); accuseStep = 0; }
  }

  /* ---------- results ---------- */
  function renderResult() {
    show('result');
    var res = S.result || {}, r = S.room, isHost = r.host_id === uid;
    var win = res.outcome === 'detective_win';
    var chars = res.characters || [];
    var culprit = chars.filter(function (c) { return c.is_culprit; })[0];
    var accused = chars.filter(function (c) { return c.char_id === res.accused_char_id; })[0];
    var title = win ? 'The detective wins. The thief is caught.' : 'The thief wins.';
    var sub = win ? 'The accusation was correct.'
      : (res.accused_char_id ? 'The detective accused ' + (accused ? accused.name : 'the wrong person') + '.' : 'Time ran out before an accusation was made.');
    $('#result-banner').className = 'banner ' + (win ? 'win' : 'lose');
    $('#result-banner').innerHTML = esc(title) + '<small>' + esc(sub) + (culprit ? ' The culprit was ' + esc(culprit.name) + (culprit.player ? ' (played by ' + esc(culprit.player) + ')' : '') + '.' : '') + '</small>';
    $('#result-explain').textContent = res.explanation || '';
    var acc = $('#result-accusation');
    if (res.accusation_text) {
      acc.classList.remove('hidden');
      acc.innerHTML = '<h3>The detective&rsquo;s case</h3><p>' + esc(res.accusation_text) + '</p>' + (res.accusation_evidence ? '<p class="muted small">Evidence cited: ' + esc(res.accusation_evidence) + '</p>' : '');
    } else acc.classList.add('hidden');
    $('#result-chars').innerHTML = chars.map(function (c) {
      return '<div class="rc' + (c.is_culprit ? ' culprit' : '') + '"><b>' + esc(c.name) + '</b> <span class="muted">' + esc(c.occupation) + (c.player ? ' · played by ' + esc(c.player) : '') + '</span>' +
        (c.is_culprit ? ' <span class="chip red">CULPRIT</span>' : '') + '<br>' + esc(c.secret_summary) + '</div>';
    }).join('');
    $('#result-evidence').innerHTML = (S.evidence || []).map(function (e) {
      return '<div class="rc"><span class="chip gold">' + esc(e.evidence_id) + '</span> <b>' + esc(e.title) + '</b><br>' + esc(e.description) + '</div>';
    }).join('');
    $('#btn-rematch').classList.toggle('hidden', !isHost);
    $('#rematch-note').textContent = isHost ? 'Everyone stays in the room. Roles are shuffled again.' : 'The host can start a rematch from here.';
  }

  /* ---------- timers ---------- */
  function tick() {
    if (!S || S.room.status !== 'playing') return;
    var r = S.room, rem = new Date(r.ends_at).getTime() - now();
    var clock = $('#clock'); clock.textContent = fmt(rem);
    clock.className = 'clock' + (rem < 60000 ? ' crit' : rem < 300000 ? ' warn' : '');
    if (rem <= 0 && !polling && Date.now() - lastForce > 1000) { lastForce = Date.now(); poll(); }
    var q = openQuestion();
    if (q) {
      var left = new Date(q.deadline_at).getTime() - now();
      var qc = $('#qcount'); if (qc) qc.textContent = left > 0 ? Math.ceil(left / 1000) + 's left' : 'closed';
      if (left <= 0) {
        var ta = $('#ans-body'), sb = $('#ans-send'); if (ta) ta.disabled = true; if (sb) sb.disabled = true;
        if (!polling && Date.now() - lastForce > 1000) { lastForce = Date.now(); poll(); }
      }
    }
  }

  /* ---------- tabs ---------- */
  function applyTab() {
    document.body.setAttribute('data-tab', tab);
    $$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-v') === tab); });
    $('#chat-pane').classList.toggle('hidden', logTab !== 'chat');
    $('#log-pane').classList.toggle('hidden', logTab !== 'log');
    $$('.subtab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-v') === logTab); });
  }

  /* ---------- global events ---------- */
  document.addEventListener('click', async function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'tab') { tab = el.getAttribute('data-v'); applyTab(); if (S) renderChat(); }
    else if (act === 'logtab') { logTab = el.getAttribute('data-v'); applyTab(); if (S) renderChat(); }
    else if (act === 'ev') openEvidence(el.getAttribute('data-id'));
    else if (act === 'script') openScript();
    else if (act === 'accuse') openAccuse();
    else if (act === 'kick') {
      try { await API.kick(code, el.getAttribute('data-id')); poll(); } catch (e) { toast(API.friendly(e)); }
    }
  });
  $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });
  $('#modal-x').addEventListener('click', closeModal);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  $('#chat-form').addEventListener('submit', sendChat);
  $('#btn-ask').addEventListener('click', askQuestion);
  ['#set-duration', '#set-qlimit', '#set-reread'].forEach(function (s) { $(s).addEventListener('change', saveSettings); });
  $('#btn-start').addEventListener('click', async function () {
    var b = $('#btn-start'); busy(b, true);
    try { await API.start(code); await poll(); } catch (e) { toast(API.friendly(e)); } finally { busy(b, false); }
  });
  $('#btn-copy').addEventListener('click', async function () {
    var link = location.origin + location.pathname + '?room=' + code;
    try { await navigator.clipboard.writeText(link); toast('Invite link copied'); }
    catch (e) { toast(link); }
  });
  async function leave() { try { await API.leaveRoom(code); } catch (e) {} clearRoom(); }
  $('#btn-leave-lobby').addEventListener('click', leave);
  $('#btn-leave-game').addEventListener('click', function () { if (confirm('Leave the room? You can rejoin with the same code while the game is running.')) leave(); });
  $('#btn-leave-result').addEventListener('click', leave);
  $('#btn-rematch').addEventListener('click', async function () {
    var b = $('#btn-rematch'); busy(b, true);
    try { await API.reset(code); await poll(); } catch (e) { toast(API.friendly(e)); } finally { busy(b, false); }
  });

  boot();
})();
