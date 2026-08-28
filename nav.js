/* ---------------------------------------------------------------------------
   nav.js - makes the wall controllable when the remote is in MOUSE MODE.

   WHY THIS EXISTS. The Fm4 remote has two modes. In keyboard mode the D-pad
   sends key codes and every page listens for them. In air-mouse mode it sends
   NOTHING of the kind: the D-pad drives a pointer and the only key event that
   ever arrives is BTN_LEFT. The remote flips between the two on its own - on
   21 August it was sending proper codes at 06:22, and by 07:02 the log held
   nothing but BTN_LEFT - and when it flips, every control on the wall goes
   dead with no explanation. It happened twice in two days.

   Worse, the pages hide the cursor, so in mouse mode you cannot even see where
   you are pointing. There was no way to tell a flipped remote from a crashed
   display.

   So: when real pointer movement is seen, the cursor comes back and two large
   arrows fade in at the edges of the screen. Click them to change page. They
   fade out again a few seconds after the pointer stops, so the artwork is
   never sharing the screen with a control nobody is using.

   It attaches to whatever the host page already provides - rotateTo() if it
   has one, CONFIG.nextPage if not - so no page needs to know about it beyond
   loading the file.
--------------------------------------------------------------------------- */
(function (global) {
  'use strict';

  const IDLE_MS = 4000;          // how long the controls linger after the last move
  const MIN_MOVE = 3;            // px, so a stray single-pixel jitter is not "use"

  let lastX = null, lastY = null, idleTimer = null, ui = null;

  function build() {
    if (ui) return ui;

    const css = document.createElement('style');
    css.textContent = `
      .navArrow {
        position: fixed; top: 50%; transform: translateY(-50%);
        z-index: 10000; width: 4.6vw; height: 4.6vw;
        min-width: 54px; min-height: 54px;
        border-radius: 50%;
        background: rgba(8,11,18,.62);
        border: 1px solid rgba(255,255,255,.28);
        color: rgba(238,244,252,.92);
        font: 300 2.4vw/1 ui-sans-serif, system-ui, sans-serif;
        display: flex; align-items: center; justify-content: center;
        opacity: 0; pointer-events: none;
        transition: opacity .45s ease-in-out;
        -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
      }
      .navArrow.prev { left: 2.2vw; }
      .navArrow.next { right: 2.2vw; }
      /* The diagnostics box holds everything the Episode review took off the
         wall - seeds, grid sizes, coordinates, per-leak tables. It was always
         reachable, but only by pressing the i key, and nobody walking
         past a television knows there is a key to press. Same control set,
         one more button. */
      .navArrow.info { right: 2.2vw; top: calc(50% + 6.4vw); font-style: italic; }
      body.pointer-live .navArrow { opacity: 1; pointer-events: auto; }
      /* The cursor is hidden everywhere by the host page; give it back only
         while a pointer is actually in use. */
      body.pointer-live, body.pointer-live * { cursor: default !important; }
      .navArrow:hover { background: rgba(20,26,38,.86); }
    `;
    document.head.appendChild(css);

    const mk = (cls, glyph, step) => {
      const b = document.createElement('div');
      b.className = 'navArrow ' + cls;
      b.textContent = glyph;
      b.addEventListener('click', (e) => { e.stopPropagation(); go(step); });
      document.body.appendChild(b);
      return b;
    };
    ui = { prev: mk('prev', '‹', -1), next: mk('next', '›', +1) };

    /* Not a page step, so it does not go through mk()'s go(). */
    const info = document.createElement('div');
    info.className = 'navArrow info';
    info.textContent = 'i';
    info.addEventListener('click', (e) => {
      e.stopPropagation();
      document.body.classList.toggle('showinfo');
      /* Pages that keep a live readout expose updateInfo(); those that do not
         simply have static content in the box already. */
      try { if (typeof updateInfo === 'function') updateInfo(); } catch (err) {}
      /* The Lane and #info want the same corner and are never both wanted. */
      try { if (global.Wall) global.Wall.hideLane(); } catch (err) {}
    });
    document.body.appendChild(info);
    ui.info = info;
    return ui;
  }

  /* Use whatever the page already has. rotateTo knows the ring in both
     directions; CONFIG.nextPage only points forwards, so on a page without
     rotateTo the back arrow simply does the same as forward rather than
     pretending to a history it does not have. */
  function go(step) {
    try {
      if (typeof rotateTo === 'function') { rotateTo(step); return; }
    } catch (e) { /* not defined on this page */ }
    try {
      const n = (typeof CONFIG === 'object' && CONFIG && CONFIG.nextPage);
      if (n) { location.href = n; return; }
    } catch (e) { /* nor this */ }
    location.reload();
  }

  function live() {
    build();
    document.body.classList.add('pointer-live');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      document.body.classList.remove('pointer-live');
    }, IDLE_MS);
  }

  addEventListener('mousemove', (e) => {
    /* Only REAL movement counts. Chromium emits a mousemove when the page
       loads under the pointer, which would otherwise pop the controls up over
       every artwork the moment it appeared. */
    if (lastX !== null && Math.abs(e.clientX - lastX) < MIN_MOVE
                       && Math.abs(e.clientY - lastY) < MIN_MOVE) return;
    lastX = e.clientX; lastY = e.clientY;
    live();
  }, { passive: true });

  // a click is use too, even without movement - that is all mouse mode sends
  addEventListener('mousedown', live, { passive: true });
})(window);
