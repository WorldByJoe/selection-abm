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

  /* "F12 S93 B6 P1" - F is the median member's fat measured in STEPS OF ITS
     OWN UPKEEP (breeding needs 25 of them in reserve, starvation is 0), then
     how this species' recent deaths divide between starvation, background
     mortality and predation; S+B+P always sums to 100. (F: Joe, 2026-09-02) */
  function vitalDeaths(e) {
    const f = e.F === undefined ? '' : 'F' + e.F + ' ';
    return e.S === undefined ? f.trim() : f + 'S' + e.S + ' B' + e.B + ' P' + e.P;
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
        + (P.sizeMouth ? ' + ' + P.sizeMouth + '×mouth' : '')
        + (P.legacyEcon ? ' · eye upkeep ' + P.eyeCost : '')],
      /* The three energy equations, stated on the wall in the same terms the
         engine uses. They were derived from mammal tissue physiology and they
         changed on 2026-09-01; the panel said the OLD ones for a while after
         the engine said the new ones, which is exactly the failure this row
         exists to prevent. Read the coefficients from P so they cannot drift
         from the model again. */
      ['METABOLISM', P.legacyEcon
        ? 'each step costs legs + body + ' + P.eyeCost + '×eyes, plus '
          + P.moveCostPer + ' per unit moved'
        : 'each step burns ' + P.basalLegs + '×legs + ' + P.basalBody
          + '×body + ' + P.basalMouth + '×mouth + ' + P.basalEyes + '×eyes'
          + ' \u2014 the gut is a small organ that runs hot, so mouth costs'
          + ' more to run than to build. Moving costs ' + P.moveCostPer
          + ' per unit distance, scaled by the animal\u2019s own upkeep, and'
          + ' digesting a meal costs ' + Math.round(P.sdaFrac*100) + '% of it'],
      ['CONSTRUCTION', P.legacyEcon
        ? 'a newborn costs its parents legs + body + mouth, plus its starting fat'
        : 'a newborn costs its parents ' + P.buildLegs + '×legs + ' + P.buildBody
          + '×body + ' + P.buildMouth + '×mouth + ' + P.buildEyes + '×eyes,'
          + ' plus the fat they endow it with \u2014 tissue mass, so legs and'
          + ' body dominate'],
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
      ['TERRAIN', P.wallCount
        ? P.wallCount + ' impassable ridges, each crossing '
          + Math.round(P.wallSpan*100) + '% of the map with ' + P.wallGaps + ' gaps'
        : 'open ground \u2014 no barriers'],
      ['HUNTING', 'gape ' + (P.gapeStrict ? 'mouth > body' : 'mouth \u2265 body')
        + ' \u00b7 strike reach ' + ((P.huntReachByEyes && !P.legacyEcon)
             ? 'max(1, hunter eyes \u2212 prey eyes) cells'
             : P.huntReach + (P.huntReach ? ' cells' : ' (own square only)'))
        /* the old wording read as though the yield WAS 0.9-0.04*legs, and did
           not say whose legs. A kill yields a FRACTION of the carcass, and the
           carcass is the prey's legs + body + fat. */
        + (P.legacyEcon
           ? ' \u00b7 a kill yields (prey legs+body+fat) \u00d7 (0.9 \u2212 '
             + P.convLegs + '\u00d7 the HUNTER\u2019s legs'
             + (P.convEyes ? ' \u2212 ' + P.convEyes + '\u00d7 its eyes' : '') + ')'
           /* Recovery is now a fraction of what each tissue COST TO BUILD, so a
              predator can never get more out of a carcass than went into it.
              Nothing about the hunter's own build enters - no measurement
              anywhere relates carcass recovery to the predator's legs or eyes. */
           : ' \u00b7 a kill yields ' + P.recLegs + '\u00d7 the prey\u2019s legs + '
             + P.recBody + '\u00d7 body + ' + P.recMouth + '\u00d7 mouth + '
             + P.recEyes + '\u00d7 eyes + ' + P.recFat + '\u00d7 its fat'
             + ' \u2014 what a carcass cost to build, times the share a predator'
             + ' can reach and digest. Gut contents are worth nothing')
        + ' \u00b7 a carnivore needs a size edge of ' + P.intraguildGap
        + ' (legs+body+mouth) to take another carnivore'],
      ['ALLOMETRY', !P.allometrySpan ? 'no allometric constraint'
        : (P.allometryLegsFree && !P.legacyEcon)
          ? 'body and mouth within ' + P.allometrySpan + ' of each other \u2014 a big gut needs a big body; legs and eyes unconstrained'
          : 'legs, body and mouth within ' + P.allometrySpan + ' of each other (eyes unconstrained)'],
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
      /* half the worlds get ridges; thin lines, so even eight of them cost
         under 5% of the ground while cutting it into semi-separate basins */
      wallCount:       R() < 0.5 ? 0 : Math.round(u(2, 10)),
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
