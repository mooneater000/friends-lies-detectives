// Thin wrapper around Supabase. The browser can only call the game functions;
// it can never read the tables directly.
(function () {
  'use strict';
  var cfg = window.FLD_CONFIG || {};
  var sb = null;

  var MESSAGES = {
    CONFIG_MISSING: 'Open config.js and paste your Supabase URL and anon key.',
    NOT_SIGNED_IN: 'Could not start a session. Please refresh.',
    ROOM_NOT_FOUND: 'That room code does not exist.',
    GAME_ALREADY_STARTED: 'That game has already started.',
    ROOM_FULL: 'That room is full.',
    NICKNAME_TAKEN: 'Someone in the room already uses that name.',
    BAD_NICKNAME: 'Choose a name of 2 to 20 characters.',
    BANNED: 'You were removed from that room.',
    NOT_HOST: 'Only the host can do that.',
    BAD_STATE: 'That is not possible right now.',
    BAD_PLAYER_COUNT: 'This mystery needs more players (or has too many).',
    CASE_INVALID: 'This case is not set up correctly in the database.',
    NOT_DETECTIVE: 'Only the detective can do that.',
    NO_QUESTIONS_LEFT: 'You have used all your official questions.',
    QUESTION_OPEN: 'Wait until the open question is finished.',
    BAD_PHASE: 'You cannot do that in this phase.',
    BAD_TARGET: 'Pick a valid player.',
    DEADLINE_PASSED: 'The response window has closed.',
    NOT_REQUIRED: 'You are not required to answer this question.',
    EMPTY_TEXT: 'Please write something first.',
    TOO_LONG: 'That is too long.',
    RATE_LIMIT: 'Slow down a little.',
    GAME_NOT_ACTIVE: 'The investigation has ended.',
    EXPLAIN_MORE: 'Write a fuller explanation (at least 10 characters).',
    BAD_CHARACTER: 'Choose one of the characters in this game.',
    SCRIPT_LOCKED: 'The host disabled reopening scripts.',
    NOT_IN_ROOM: 'You are not in that room.',
    NOT_STARTED: 'The game has not started yet.'
  };

  function client() {
    if (!sb) {
      if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.indexOf('YOUR-PROJECT') !== -1 ||
          !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.indexOf('YOUR-ANON') !== -1) {
        throw new Error('CONFIG_MISSING');
      }
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    }
    return sb;
  }

  // Each browser gets an anonymous account that survives refreshes, so
  // reconnecting puts you back in the same character.
  async function ensureUser() {
    var c = client();
    var res = await c.auth.getSession();
    if (res.data && res.data.session && res.data.session.user) return res.data.session.user.id;
    var out = await c.auth.signInAnonymously();
    if (out.error) { var e = new Error('ANON_FAILED'); e.raw = out.error; throw e; }
    return out.data.user.id;
  }

  async function rpc(fn, args) {
    var out = await client().rpc(fn, args || {});
    if (out.error) {
      var msg = out.error.message || '';
      var e = new Error(msg);
      e.code = /^[A-Z_]+$/.test(msg) ? msg : 'UNKNOWN';
      e.raw = out.error;
      if (e.code === 'UNKNOWN') console.error(fn, out.error);
      throw e;
    }
    return out.data;
  }

  function friendly(e) {
    if (!e) return 'Something went wrong.';
    if (e.message === 'ANON_FAILED') {
      return 'Could not start a session. In Supabase, turn on Authentication > Sign In / Providers > Allow anonymous sign-ins.';
    }
    return MESSAGES[e.code] || MESSAGES[e.message] || 'Something went wrong. Please try again.';
  }

  window.FLD_API = {
    ensureUser: ensureUser,
    friendly: friendly,
    createRoom: function (c, d, n, a) { return rpc('create_room', { p_case: c, p_duration: d, p_nick: n, p_avatar: a }); },
    joinRoom: function (code, n, a) { return rpc('join_room', { p_code: code, p_nick: n, p_avatar: a }); },
    leaveRoom: function (code) { return rpc('leave_room', { p_code: code }); },
    kick: function (code, u) { return rpc('kick_player', { p_code: code, p_user: u }); },
    updateRoom: function (code, d, q, r) { return rpc('update_room', { p_code: code, p_duration: d, p_qlimit: q, p_reread: r }); },
    start: function (code) { return rpc('start_game', { p_code: code }); },
    reset: function (code) { return rpc('reset_room', { p_code: code }); },
    getState: function (code) { return rpc('get_state', { p_code: code }); },
    getScript: function (code) { return rpc('get_my_script', { p_code: code }); },
    sendMessage: function (code, cid, body) { return rpc('send_message', { p_code: code, p_client: cid, p_body: body }); },
    ask: function (code, target, body) { return rpc('ask_question', { p_code: code, p_target: target, p_body: body }); },
    answer: function (qid, body) { return rpc('submit_answer', { p_question: qid, p_body: body }); },
    accuse: function (code, ch, why, evi) { return rpc('accuse', { p_code: code, p_char: ch, p_text: why, p_evidence: evi }); }
  };
})();
