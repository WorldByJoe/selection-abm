/* ============================================================================
   ecology_ui.js - display helpers shared by every Selection front end.

   WHY THIS FILE EXISTS. The wall page and the OneDrive lab both show the same
   two things: the per-species vital rates, and a card naming the settings the
   running world was actually given. Written twice they would drift the moment
   a rule changed, and the card's whole promise is that it never lies about the
   model. So they live here once, are derived from world.P at call time, and
   both pages read from the same source.

   Nothing in this file simulates anything - it only formats. The model stays
   in ecology_engine.js.
   ========================================================================= */
(function (global) {
  'use strict';

  /* Small rates matter: background death is 0.002, and rounding to a whole
     percent reported it on the wall as "0%". Keep enough digits to be
     truthful, drop trailing zeros so 5% stays 5%. */
  function pct(v) {
    const x = v * 100;
    return (x >= 1 ? x.toFixed(0)
                   : x.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + '%';
  }

  /* R, the species' birth rate: births per step as a percentage of its own
     headcount. Two decimals below 1% so a slow lineage is not shown as 0. */
  function rate(v) { return (v < 1 ? v.toFixed(2) : v.toFixed(1)) + '%'; }

  /* "R 1.2%" for a species row, or '' when the window holds no births yet. */
  function vitalR(e) { return e.R === undefined ? '' : 'R ' + rate(e.R); }

  /* "S93 B6 P1" - how this species' recent deaths divide between starvation,
     background mortality and predation. Always sums to 100. */
  function vitalDeaths(e) {
    return e.S === undefined ? '' : 'S' + e.S + ' B' + e.B + ' P' + e.P;
  }

  /* The settings this world was given - the same fields the lab exposes on its
     setup sheet, read live off world.P so they cannot drift from what is
     actually running. Deliberately NOT a description of the mechanics: Joe
     asked for the values that were assigned, not the calculations.
     ADD A LINE HERE whenever a new dial is added to the model. */
  function settingsCard(w, seed) {
    const P = w.P;
    const f = (w.founders || []).map(o =>
      'L' + o.legs + '.B' + o.body + '.M' + o.mouth + '.E' + o.eyes +
      '.' + (o.bigF ? 'F' : 'f') + '.' + (o.carn ? 'C' : 'H') +
      '×' + (o.count !== undefined ? o.count : '?')
    ).join('  ');
    const rows = [
      ['SEED', String(seed)],
      ['LANDSCAPE', P.W + '×' + P.H + ' cells · patch size ' + P.patchRange +
        ' · patch contrast ' + P.patchSill + ' · growth ' + pct(P.growLo) +
        '–' + pct(P.growHi) + ' per step · grass cap ' + P.grassMax +
        ' · regrows 1 step in ' + P.regrowEvery],
      ['TERRITORY', 'per-cell cap ' + P.cellCap +
        (P.capPerDiet ? ' counted per diet' : ' shared') +
        ' · size = legs + body' + (P.sizeEyes ? ' + ' + P.sizeEyes + '×eyes' : '')
        + (P.sizeMouth ? ' + ' + P.sizeMouth + '×mouth' : '') +
        ' · eye upkeep ' + P.eyeCost],
      ['PROVISIONING', 'f gives a newborn ' + P.provLowSteps +
        ' steps of its own upkeep, F gives ' + P.provHighSteps +
        ' \u2014 species-identifying, so f and F do not interbreed'],
      ['DISTURBANCE', P.disturbEvery
        ? 'a patch is hit about every ' + P.disturbEvery + ' steps · diameter '
          + P.disturbDiamLo + '\u2013' + P.disturbDiamHi
          + ' (mostly small) · kills ' + Math.round(P.disturbKill*100)
          + '% of the animals in it and strips '
          + Math.round((P.disturbCoupled?P.disturbKill:P.disturbGrass)*100)
          + '% of the grass'
        : 'none \u2014 this world is never disturbed'],
      ['HUNTING', 'gape ' + (P.gapeStrict ? 'mouth > body' : 'mouth \u2265 body')
        + ' \u00b7 strike reach ' + P.huntReach + (P.huntReach ? ' cells' : ' (own square only)')
        + ' \u00b7 a kill yields 0.9 \u2212 ' + P.convLegs + '\u00d7legs'
        + (P.convEyes ? ' \u2212 ' + P.convEyes + '\u00d7eyes' : '')
        + ' \u00b7 a carnivore needs a size edge of ' + P.intraguildGap
        + ' (legs+body+mouth) to take another carnivore'],
      ['BUILD', P.allometrySpan
        ? 'legs, body and mouth within ' + P.allometrySpan + ' of each other (eyes unconstrained)'
        : 'no allometric constraint'],
      ['LIFE', 'mutation ' + pct(P.mutationP) + ' · background death ' +
        pct(P.mortality) + ' per step · repro reserve ' + P.reproReserveSteps +
        ' steps · gape ' + (P.gapeStrict ? 'mouth > body' : 'mouth ≥ body') +
        ' · quest litters ' + P.questLitters],
      ['FOUNDERS', f],
    ];
    return rows.map(r => '<b>' + r[0] + '</b> ' + r[1]).join('<br>');
  }

  /* A RANDOM LANDSCAPE for each world (Joe, 2026-08-29). Until now only the
     founders were drawn at random and every world got the same ground, so a
     run's ecology was the same landscape over and over. These ranges are wide
     enough to give genuinely different worlds - fine-grained or coarse
     patchwork, poor or rich, sparse steppe or deep forest - while staying
     inside settings we have actually run.

     grassMax matters more than it looks: concealment gives the 10% hidden
     floor only when a cell's grass covers the prey's legs + body + fat, so
     grassMax IS the ceiling on how large an animal can ever hide. At 20 only
     the smallest can; at 120 nothing is ever fully exposed. Randomising it
     means the predator-prey balance differs between worlds by design.

     `rand` is any () => [0,1) - the caller's, so a page can seed it. */
  function randomLandscape(rand) {
    const R = rand || Math.random;
    const u = (lo, hi) => lo + R() * (hi - lo);
    const growLo = +u(0.01, 0.06).toFixed(3);
    return {
      patchRange:  Math.round(u(3, 30)),
      patchSill:   +u(0.4, 1.0).toFixed(2),
      grassMax:    Math.round(u(20, 120)),
      growLo:      growLo,
      growHi:      +Math.min(0.30, growLo + u(0.03, 0.24)).toFixed(3),
      regrowEvery: Math.round(u(3, 7)),
      /* The f/F balance is very sensitive to the cheap allowance - measured
         F share 95/78/51/24% at provLow 2/3/4/5 against provHigh 10 - so
         drawing it per run means the wall explores worlds that favour cheap
         offspring, worlds that favour well-provisioned ones, and the tie in
         between. Below 2 the cheap strategy is not a strategy but a death
         sentence, so the range starts there. */
      provLowSteps:  Math.round(u(2, 6)),
      provHighSteps: Math.round(u(8, 10)),
      /* A DISTURBANCE REGIME per world. One in four worlds gets none, so
         there is always an undisturbed comparison running somewhere. The
         kill and grass fractions are drawn INDEPENDENTLY: a world can be a
         disease (kills animals, spares the grass), a drought (spares animals,
         strips the grass), or a fire (both). */
      disturbEvery:    R() < 0.25 ? 0 : Math.round(u(120, 1500)),
      disturbDiamLo: Math.round(u(4, 10)),
      disturbDiamHi: Math.round(u(24, 90)),
      disturbKill:     +u(0.2, 1.0).toFixed(2),
      disturbGrass:    +u(0.0, 1.0).toFixed(2),
    };
  }

  /* "age 19" - the median age of this species' living members. Median, not
     mean, because every population carries a few very old survivors that drag
     a mean upward and describe nobody. */
  function vitalAge(e) { return e.medianAge === undefined ? '' : 'age ' + e.medianAge; }

  global.EcoUI = { pct, rate, vitalR, vitalDeaths, vitalAge, randomLandscape,
                   settingsCard };
})(typeof window !== 'undefined' ? window : globalThis);
