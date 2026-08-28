/* ---------------------------------------------------------------------------
   wall.js - the wall's shared language layer.

   WHY THIS FILE EXISTS. Every page used to invent its own caption band, its
   own title card and its own scrim, and the result was thirteen dialects of
   the same idea sitting in thirteen slightly different places. That is what
   "the HUDs came about piecemeal" actually meant. wall.css gave the wall type
   tokens but nothing to hang them on, and the seven role classes it defines
   were used by no page at all.

   More importantly the old captions were PERMANENT, and a permanent sentence
   on a changing picture is a sentence about nothing in particular. tree said
   the same words three metres of growth apart. surnames said "Eight names
   left" directly above a line reading "3 surnames". descent said OFF THE
   BRAKES while its own panel read 4 mph on a 2% grade.

   So language here belongs to an EPISODE, not to a page. It arrives, says one
   true thing about the picture underneath it, and dissolves. Two thirds of
   every minute the wall is only the artwork.

   THE FOUR CALLS, and there are no others:

     Wall.lane(text, opts)      one or two sentences, bottom centre, fitted
                                plate, timed hold, then gone.
     Wall.moment(text, opts)    four words or fewer on something that just
                                happened, placed against its subject.
     Wall.signature(text, opts) legal attribution, on the pages that owe one.
     Wall.instrument(spec)      the page's permanent live readout panel. Call
                                it every frame; it only touches the DOM when
                                a value actually changes.
     Wall.after / Wall.every    timers that are remembered, so a page can tear
                                its whole schedule down in one call.

   LAW 1 IS ENFORCED HERE, NOT BY CONVENTION. At most one region of running
   prose may be lit in any frame. lane() and moment() share a single lock:
   whichever speaks second silences the first. A page cannot violate it by
   accident, which is the only kind of violation that has ever happened.
--------------------------------------------------------------------------- */
(function (global) {
  'use strict';

  /* --- how long a sentence holds ------------------------------------------
     Proportional to its length rather than fixed. Fourteen seconds is right
     for weather's two-line mechanism paragraph and much too long for
     reaction's five-word pattern line - and reaction fires thirteen times in
     a turn, so a fixed hold would make the shortest page the most talkative.
     About 1.1 s per ten characters, floored and capped.

     Joe has not ruled on this yet; it is open question 1 in the review. The
     numbers live here so there is one place to change them. */
  const MS_PER_CHAR   = 110;     // 1.1 s per ten characters
  const HOLD_MIN      = 8000;
  const HOLD_MAX      = 16000;
  const FADE_IN       = 600;
  const FADE_OUT      = 1200;

  const MOMENT_HOLD   = 4000;    // a Moment is an interjection, not a caption
  const MOMENT_GAP    = 6000;    // minimum silence between two Moments

  /* --- timer registry ------------------------------------------------------
     Pages used to scatter bare setTimeouts and then have no way to cancel the
     schedule when an episode ended early or the page handed off. A stale timer
     firing after a hand-off writes into a dead DOM; a stale timer firing after
     a reseed narrates the previous episode. Both were observed. */
  const timers = new Set();
  function after(ms, fn) {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  }
  function every(ms, fn) {
    const id = setInterval(fn, ms);
    timers.add(id);
    return id;
  }
  function clearTimers() {
    for (const id of timers) { clearTimeout(id); clearInterval(id); }
    timers.clear();
  }

  /* --- elements, made once and reused -------------------------------------
     Creating them lazily means a page that never speaks never grows a node,
     and a page that speaks often does not churn the DOM. */
  let laneEl = null, laneSpan = null, momentEl = null, sigEl = null;
  function lane_() {
    if (laneEl) return laneEl;
    laneEl = document.createElement('div');
    laneEl.className = 'lane';
    laneSpan = document.createElement('span');
    laneEl.appendChild(laneSpan);
    document.body.appendChild(laneEl);
    return laneEl;
  }
  function moment_() {
    if (momentEl) return momentEl;
    momentEl = document.createElement('div');
    momentEl.className = 'moment';
    document.body.appendChild(momentEl);
    return momentEl;
  }

  /* --- Law 1: one voice at a time ----------------------------------------- */
  let voice = null;              // 'lane' | 'moment' | null
  let laneTimer = null, momentTimer = null, lastMomentAt = -1e9;

  function hideLane(immediate) {
    if (!laneEl) return;
    laneEl.classList.remove('show');
    document.body.classList.remove('lane-lit');
    if (voice === 'lane') voice = null;
    if (laneTimer) { clearTimeout(laneTimer); timers.delete(laneTimer); laneTimer = null; }
    if (immediate) laneEl.style.transitionDuration = '0s';
  }
  function hideMoment() {
    if (!momentEl) return;
    momentEl.classList.remove('show');
    if (voice === 'moment') voice = null;
    if (momentTimer) { clearTimeout(momentTimer); timers.delete(momentTimer); momentTimer = null; }
  }

  function holdFor(text) {
    return Math.max(HOLD_MIN, Math.min(HOLD_MAX, (text || '').length * MS_PER_CHAR));
  }

  /* --- THE LANE ------------------------------------------------------------
     opts: { hold  ms, overriding the proportional default
             figures  true for the numeric close-of-episode beat
             light    true on a light ground (tree, hike, pale reaction)
             onDone   called after the sentence has fully dissolved }

     Returns the total ms the sentence will occupy, so a caller can schedule
     what follows without duplicating the arithmetic. */
  function lane(text, opts) {
    opts = opts || {};
    if (!text) { hideLane(); return 0; }
    /* #info and the Lane are never both wanted: one is for the sofa and the
       other is for somebody at a keyboard, and they occupy the same corner. */
    if (document.body.classList.contains('showinfo')) return 0;

    hideMoment();
    const el = lane_();
    el.style.transitionDuration = '';
    el.classList.toggle('figures', !!opts.figures);
    el.classList.toggle('on-light', !!opts.light);
    laneSpan.textContent = text;

    const hold = opts.hold != null ? opts.hold : holdFor(text);
    voice = 'lane';
    /* One frame between attaching the text and lighting it, or the browser
       coalesces the two and the fade never runs. */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (voice === 'lane') {
        el.classList.add('show');
        document.body.classList.add('lane-lit');
      }
    }));

    laneTimer = after(FADE_IN + hold, () => {
      laneTimer = null;
      hideLane();
      if (opts.onDone) after(FADE_OUT, opts.onDone);
    });
    return FADE_IN + hold + FADE_OUT;
  }

  /* --- clear-space search --------------------------------------------------
     Lifted from plume's peak call-out routine, which offers seven candidate
     positions around a marker and takes the first that does not collide. It
     was the best-behaved label code on the wall and it becomes the shared
     primitive, so Moments and Marks place themselves the same way everywhere.

     Candidates are tried in order of how little they obscure: above first,
     because on every page in the rotation the interesting thing is below or
     beside the subject rather than above it. */
  const CANDIDATES = [
    [ 0,  -1.15], [ 1.05, -0.75], [-1.05, -0.75],
    [ 1.20,  0.10], [-1.20,  0.10],
    [ 0.90,  0.85], [-0.90,  0.85],
  ];
  function place(subject, w, h, avoid) {
    const W = innerWidth || 1920, H = innerHeight || 1080;
    const pad = Math.max(24, W * 0.012);
    if (!subject) return { x: W / 2, y: H * 0.42 };
    const hits = (x, y) => {
      if (x - w / 2 < pad || x + w / 2 > W - pad) return true;
      if (y - h / 2 < pad || y + h / 2 > H - pad) return true;
      for (const a of (avoid || [])) {
        if (Math.abs(a.x - x) < (a.r || 0) + w / 2 &&
            Math.abs(a.y - y) < (a.r || 0) + h / 2) return true;
      }
      return false;
    };
    for (const [dx, dy] of CANDIDATES) {
      const x = subject.x + dx * (w / 2 + pad * 2);
      const y = subject.y + dy * (h / 2 + pad * 2);
      if (!hits(x, y)) return { x, y };
    }
    return { x: W / 2, y: H * 0.42 };   // give up honestly rather than overlap
  }

  /* --- THE MOMENT ----------------------------------------------------------
     opts: { exact  place at `at` verbatim, no clear-space search
             at     {x,y} of the subject in CSS pixels; omit on pages whose
                    subject is not a place (surnames, reaction, physarum,
                    kiosk, occasion) and it falls back to upper centre
             avoid  [{x,y,r}] regions to keep clear
             light  true on a light ground
             force  fire even if the gap has not elapsed }

     Returns true if it fired. A Moment that is refused is not an error - the
     silence is the design. */
  function moment(text, opts) {
    opts = opts || {};
    if (!text) return false;
    if (document.body.classList.contains('showinfo')) return false;
    const now = performance.now();
    if (!opts.force && now - lastMomentAt < MOMENT_GAP) return false;

    hideLane();
    const el = moment_();
    el.classList.toggle('on-light', !!opts.light);
    el.textContent = text;
    /* Measure after the text is in, before it is lit, so the placement search
       works on the real box rather than a guess. */
    el.style.left = '-9999px'; el.style.top = '-9999px';
    const r = el.getBoundingClientRect();
    /* opts.exact puts the Moment exactly where the caller says, with no
       search. descent needs it: its chase camera holds the rider near frame
       centre all run, so its Moments are bound to the empty sky above the
       ridgeline rather than offset from a subject. Searching around a fixed
       point would only push them back down toward the rider. */
    const p = opts.exact && opts.at ? opts.at
            : place(opts.at, r.width, r.height, opts.avoid);
    el.style.left = p.x + 'px';
    el.style.top  = p.y + 'px';

    lastMomentAt = now;
    voice = 'moment';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (voice === 'moment') el.classList.add('show');
    }));
    momentTimer = after(MOMENT_HOLD, () => { momentTimer = null; hideMoment(); });
    return true;
  }

  /* --- THE SIGNATURE -------------------------------------------------------
     Legal attribution and nothing else. Permanent, on the five pages that owe
     one: plume, weather, precip, reading, hike.
     opts: { plated true where the ground under the bottom-left corner is busy
                    - hike's cream topo and precip's radar cores both defeat an
                      unplated line
             light  true on a light ground } */
  function signature(text, opts) {
    opts = opts || {};
    if (!sigEl) {
      sigEl = document.createElement('div');
      sigEl.className = 'signature';
      document.body.appendChild(sigEl);
    }
    sigEl.textContent = text || '';
    sigEl.classList.toggle('plated', !!opts.plated);
    sigEl.classList.toggle('on-light', !!opts.light);
    sigEl.style.display = text ? '' : 'none';
    return sigEl;
  }

  /* --- THE INSTRUMENT ------------------------------------------------------
     Permanent, continuously visible, and recomputed every frame. The review
     that removed these was wrong about why the old captions failed: they
     failed because they were STATIC, not because they were permanent. On
     surnames and on descent the permanent LIVE readout was the layer telling
     the truth while the prose was the layer lying.

     spec = {
       hero  {v, u}          the one number the page is most about
       rows  [{k, v}]        label / value pairs, laid out in two columns
       keys  [{c, v, n}]     a colour key: swatch, value, note
       strip {k, items[{c,label}]}   a compact one-row colour ramp
       cap   string          one small caption line, e.g. "PASS 1 / 2"
       cols  1 | 2           default 2
       light true on a light ground
       place 'tl' | 'tr' | 'bl'   default 'tl'
     }
     Pass null to hide it.

     CALL THIS EVERY FRAME. It rebuilds the DOM only when the SHAPE changes -
     a different set of row labels, a key appearing - and otherwise writes
     only the values that actually differ from what is already on screen. A
     page that re-rendered eight rows sixty times a second would spend more
     time in layout than in its own simulation. */
  /* A page may run more than one panel - plume reserves a rail down the
     right for its leak table and a band along the bottom for the survey
     scalars, two separate pieces of furniture with different shapes. Each
     spec.id gets its own element, shape cache and diff state; the default id
     keeps the old single-panel behaviour.

     spec.mount names a container (a selector or an element). A mounted panel
     drops its own plate, border and fixed position - the container IS the
     furniture, and a plate inside a plate is how the old wall got its
     piecemeal look. spec.flow lays the rows out in one wrapping line instead
     of the two-column grid, which is what a wide flat band wants. */
  const instrs = {};

  function instrument(spec) {
    const id = (spec && spec.id) || 'main';
    let inst = instrs[id];
    if (!spec) { if (inst && inst.el) inst.el.style.display = 'none'; return; }
    if (!inst) inst = instrs[id] = { el: null, shape: '', nodes: null, last: null };
    if (!inst.el) {
      inst.el = document.createElement('div');
      inst.el.className = 'instr';
      let host = document.body;
      if (spec.mount) {
        const m = typeof spec.mount === 'string' ? document.querySelector(spec.mount) : spec.mount;
        if (m) { host = m; inst.el.classList.add('mounted'); }
      }
      host.appendChild(inst.el);
    }
    const instrEl = inst.el;
    instrEl.style.display = '';
    instrEl.classList.toggle('on-light', !!spec.light);
    instrEl.classList.toggle('tr', spec.place === 'tr');
    instrEl.classList.toggle('bl', spec.place === 'bl');

    const rows = spec.rows || [], keys = spec.keys || [];
    const shape = [
      spec.hero ? 'H' + (spec.hero.u || '') : '-',
      rows.map(r => r.k).join('|'),
      'k' + keys.length,
      (spec.strips || (spec.strip ? [spec.strip] : []))
        .map(sp => 's' + (sp.items || []).length + (sp.k || '')).join('~') || '-',
      spec.cap != null ? 'c' : '-',
      spec.cols === 1 ? '1' : '2',
    ].join('/');

    if (shape !== inst.shape) {
      instrEl.textContent = '';
      inst.nodes = { hero: null, heroU: null, rows: [], keys: [], cap: null, strip: null };
      inst.last  = { hero: null, rows: [], keys: [], cap: null };
      const instrNodes = inst.nodes;

      if (spec.hero) {
        const h = el('div', 'hero');
        instrNodes.hero  = h.appendChild(el('span', 'hv'));
        instrNodes.heroU = h.appendChild(el('span', 'hu'));
        instrNodes.heroU.textContent = spec.hero.u || '';
        instrEl.appendChild(h);
      }
      if (rows.length) {
        const g = el('div', 'grid' + (spec.cols === 1 ? ' one' : '') + (spec.flow ? ' flow' : ''));
        for (const r of rows) {
          const row = el('div', 'row');
          row.appendChild(el('span', 'k')).textContent = r.k;
          instrNodes.rows.push(row.appendChild(el('span', 'v')));
          g.appendChild(row);
        }
        instrEl.appendChild(g);
      }
      if (keys.length) {
        if (rows.length || spec.hero) instrEl.appendChild(el('div', 'sep'));
        const kw = el('div', 'keys');
        for (const k of keys) {
          const kr = el('div', 'keyrow');
          const sw = kr.appendChild(el('span', 'sw'));
          sw.style.background = k.c || 'transparent';
          /* Value and note stack vertically beside the swatch: side by side
             they need ~700 px, which a 595 px rail does not have. */
          const kt = kr.appendChild(el('span', 'kt'));
          const kv = kt.appendChild(el('span', 'kv'));
          const kn = kt.appendChild(el('span', 'kn'));
          instrNodes.keys.push({ sw: sw, v: kv, n: kn, row: kr });
          kw.appendChild(kr);
        }
        instrEl.appendChild(kw);
      }
      /* A page may need more than one colour ramp - plume keys both its
         clean-air passes and its leak-evidence heat. spec.strips is the
         list; spec.strip stays as sugar for one. */
      const stripSpecs = spec.strips || (spec.strip ? [spec.strip] : []);
      if (stripSpecs.length) {
        if (rows.length || keys.length || spec.hero) instrEl.appendChild(el('div', 'sep'));
        for (const sp of stripSpecs) {
          const st = el('div', 'strip');
          st.appendChild(el('span', 'k')).textContent = sp.k || '';
          const sws = st.appendChild(el('div', 'sws'));
          for (const it of (sp.items || [])) {
            const cell = sws.appendChild(el('div', 'st'));
            const sw = cell.appendChild(document.createElement('i'));
            /* ring:true keys a map MARKER (plume's indication circle):
               same slot, drawn hollow the way it appears on the ground. */
            if (it.ring) sw.className = 'ring', sw.style.borderColor = it.c || 'transparent';
            else sw.style.background = it.c || 'transparent';
            const lb = cell.appendChild(document.createElement('b'));
            lb.textContent = it.label == null ? '' : String(it.label);
          }
          instrEl.appendChild(st);
        }
      }
      if (spec.cap != null) instrNodes.cap = instrEl.appendChild(el('div', 'cap'));
      inst.shape = shape;
    }
    const instrNodes = inst.nodes, instrLast = inst.last;

    /* --- write only what changed ------------------------------------- */
    if (instrNodes.hero && spec.hero) {
      const v = String(spec.hero.v);
      if (v !== instrLast.hero) { instrNodes.hero.textContent = v; instrLast.hero = v; }
    }
    for (let i = 0; i < instrNodes.rows.length; i++) {
      const v = String(rows[i] ? rows[i].v : '');
      if (v !== instrLast.rows[i]) { instrNodes.rows[i].textContent = v; instrLast.rows[i] = v; }
    }
    for (let i = 0; i < instrNodes.keys.length; i++) {
      const k = keys[i] || {}, n = instrNodes.keys[i];
      const sig = (k.c || '') + '\x1f' + (k.v || '') + '\x1f' + (k.n || '') + '\x1f' + (k.bg || '');
      if (sig !== instrLast.keys[i]) {
        n.sw.style.background = k.c || 'transparent';
        n.v.textContent = k.v == null ? '' : String(k.v);
        n.n.textContent = k.n == null ? '' : String(k.n);
        /* A row may carry a VERDICT ground - plume tints its leak table
           green/red at the close of a survey. Only rows that ask get one. */
        n.row.style.background = k.bg || '';
        n.row.classList.toggle('verdict', !!k.bg);
        instrLast.keys[i] = sig;
      }
    }
    if (instrNodes.cap) {
      const c = String(spec.cap);
      if (c !== instrLast.cap) { instrNodes.cap.textContent = c; instrLast.cap = c; }
    }
  }
  function el(tag, cls) { const e = document.createElement(tag); e.className = cls; return e; }

  /* --- the episode helper --------------------------------------------------
     Most pages want exactly this: at the start of an episode, wait a beat so
     the picture establishes alone, then say one sentence. Pulling it here
     stops thirteen pages each choosing their own opening delay. */
  const ARRIVE_MS = 2000;
  function episode(text, opts) {
    opts = opts || {};
    clearEpisode();
    if (!text) return;
    after(opts.arrive != null ? opts.arrive : ARRIVE_MS, () => lane(text, opts));
  }
  /* Cancel only the language schedule, leaving a page's own timers alone. */
  function clearEpisode() { hideLane(); hideMoment(); }

  global.Wall = {
    lane, moment, signature, instrument, episode, clearEpisode,
    after, every, clearTimers, holdFor, place,
    hideLane, hideMoment,
    ARRIVE_MS, FADE_IN, FADE_OUT, MOMENT_HOLD,
  };
})(window);
