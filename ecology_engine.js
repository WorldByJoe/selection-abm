/* ============================================================================
   ecology_engine.js - community ecology + evolution, agent-based. Joe's spec,
   2026-08-28. PURE SIMULATION: no DOM, no clocks, seeded randomness - the
   same file runs in the wall page and under the jsc test harness, so the
   ecology can be balance-tested at thousands of steps per second before a
   pixel is drawn (the exoplanets.js pattern: the page must never be the only
   way to run the model).

   THE SPEC, and where this file departs from or fills in silence:

   GRID  160 x 90. Each cell grows grass: +1 unit on a bare cell, x1.10 on an
   occupied one. DECISION (spec silent): grass is capped at grassMax - 10%
   compounding is exponential and an uncapped cell out-runs every herbivore
   in ~50 steps; the cap makes standing crop a real, exhaustible resource.

   ANIMALS carry legs, body, mouth, eyes as integers 0..10 and fat as a
   continuous store. One action per step: MOVE up to legs distance (radius),
   EAT grass (gains min(MOUTH, grass here), always succeeds), EAT an animal
   in the same cell, or MATE. The mouth is the feeding organ for BOTH diets
   (Joe, 2026-08-28: the original "eat one body amount" left mouth costless
   for herbivores - it prices offspring and inflates concealment size but
   bought nothing - and selection promptly bred M0 herbivores that grazed
   perfectly well. Mouth-limited intake gives the trait an honest benefit:
   a mouthless animal starves, and a big body needs a big mouth to fuel).

   PREDATION (Joe's rules, 2026-08-28/29):
   - GAPE, strict: the predator's mouth must EXCEED the prey's body -
     equal no longer swallows equal, which closes self-predation for every
     species whose mouth does not out-size its own body.
   - CONCEALMENT (replacing the original flat 50%): with S = the prey's
     legs+body+fat, a prey standing in grass >= S is caught only 10% of the
     time; below that, success rises linearly to 100% on bare ground. An
     overgrazed commons is a killing field, fat is a visibility cost, and
     tall grass is worth fighting over. MOUTH WAS REMOVED from S (Joe,
     2026-08-28): a big mouth is not a big silhouette, and while it sat in
     this term it made mouth a triple liability, which is what drove every
     observed regime flip one way.
   - CONVERSION EFFICIENCY: a kill yields the prey's legs+body+fat scaled
     by the predator's trophic efficiency, 0.9 - 0.04 x (eyes + legs):
     90% for a sessile, sightless ambusher, 10% for a maximal courser.
     Sensory and locomotor machinery is paid for out of every meal, which
     carves an ambush-vs-pursuit axis into the predator guild.

   MATING needs a partner on the same or adjacent cell with EQUAL legs,
   body, mouth, eyes AND THE SAME DIET (Joe, 2026-08-28: a carnivore and an
   herbivore are different species however alike their bodies - the keys,
   the table and the phylogeny already said so, and mating now agrees). So
   "species" is not a label here, it is trait-identity, and every mutation
   - a diet flip most of all - is a step toward reproductive isolation.
   Both parents need fat above the build cost legs+body+mouth (plus the
   reserve parameter below); per offspring each parent pays half the build
   cost, and pairs keep producing while both stay eligible.
   DECISION (spec silent): a newborn starts with babyFat units of its own -
   born at zero it would starve before its first act - and each parent pays
   half of that too. Parents share a diet, and the newborn inherits it
   (unless mutation flips it).

   MUTATION: 5% per birth. One of five equally likely outcomes: legs, body,
   mouth or eyes shifts +-1, or the diet flips between herbivore and
   carnivore. TRAIT FLOORS (Joe, 2026-08-28): legs and eyes may reach 0 -
   sessile and blind are real body plans - but body and mouth bottom out
   at 1: an animal with no body or no mouth is not an animal. (An M0
   creature could eat nothing at all under mouth-limited intake; a B0 one
   was only ever a bookkeeping ghost.) Ceiling 10 for all four.

   PERCEPTION: an animal sees everything within eyes cells of itself -
   grass, animals, and their trait values - and chooses its action to
   satisfy eating, reproduction, and predator avoidance.

   METABOLISM: each step fat falls by 0.1 x (distance moved) + 0.1 x
   max(1, legs + body + eyeCost x eyes) - locomotor AND sensory tissue are
   carried whether or not they are used (Joe, 2026-08-28; formerly body
   alone, then legs+body).
   Below 1 unit of fat the animal starves. Carnivores gain prey legs + body
   + fat; they cannot eat grass (a flipped diet must pay its way by hunting).

   START: four herbivore species, ten animals each, one species per corner.

   THE THREE RISK-TOLERANCE PARAMETERS Joe called out - all in DEFAULTS,
   all with the reasoning beside them:
     reproReserveSteps - reproduction vs starvation: how many steps of body
                         metabolism a parent keeps for itself before it will
                         spend fat on offspring.
     dangerWeight +
     braveryFloor      - predation vs starvation: how strongly a visible
                         predator repels, and how much of that aversion a
                         starving animal abandons.
     mateWeight        - mate finding vs predation: how strongly a visible
                         eligible mate attracts, competing directly with
                         fear in the same score.
   ========================================================================= */
(function (global) {
'use strict';

/* Deterministic RNG - a seeded run replays exactly, which is what makes
   headless balance experiments comparable. */
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t;
  return ((t^t>>>14)>>>0)/4294967296; }; }

const DEFAULTS = {
  W:160, H:90,
  grassMax: 50,           // DECISION: cap on a cell's standing crop
  regrowEvery: 1,         // DECISION KNOB: a grazed-bare cell needs this many
                          // steps to sprout its first unit. 1 = the spec
                          // exactly - and the spec's regrowth income supports
                          // an equilibrium of 30-50k animals (measured: still
                          // 28k and climbing at t=800), which no wall can
                          // step at watchable speed. The wall page passes a
                          // larger value; the model itself stays faithful.
  grassInit: 3,           // the world starts vegetated, not bare

  /* --- THE LAND IS NOT UNIFORM (Joe, 2026-08-28) ----------------------
     Every cell draws a growth quality from a spatially autocorrelated
     random field, so the map has good ground and poor ground in PATCHES
     rather than pixel-by-pixel noise. growLo..growHi is the per-step
     compounding rate a cell supports - CENTRED ON 10% (Joe, 2026-08-28),
     so the landscape varies without cutting total productivity the way a
     1%..10% band did - and a bare cell's
     sprouting scales with the same quality, so poor ground both grows
     slowly and recovers slowly. patchRange is the correlation length in
     cells - the "range" of the variogram; patchSill is how much of the
     spread survives normalisation (1 = full 1%..10% span). */
  /* --- TERRITORY (Joe, 2026-08-28) ------------------------------------
     A cell holds at most cellCap animals. A bigger animal - size is
     legs+body+mouth+eyes, the whole organism - can evict a smaller one and
     take its place; the loser is pushed to the nearest cell with room.
     Eviction needs STRICTLY greater size, so trait-identical animals
     cannot displace each other, which lets a mated pair hold a good pixel
     against each other while still yielding to anything larger. This is
     the first benefit size has ever had in the model.

     WHAT COUNTS AS SIZE: legs + body + eyes, and mouth only at weight
     sizeMouth. Joe, 2026-08-28: mouth left the contest because it was the
     cheapest way to be big - it costs nothing in basal metabolism, so
     selection bought territory with mouth and left body pinned at 1. With
     mouth out, every unit of contest size is metabolically paid for, and
     body is the one that also earns a gape refuge. (A mouth does carry
     teeth, so sizeMouth 1 restores it to the brawl if that reading is
     preferred - it is a weight, not a boolean.) */
  cellCap: 2,
  sizeMouth: 0,
  capPerDiet: true,       /* Joe, 2026-08-28: the cap is counted SEPARATELY
     for each diet, so a pixel holds up to cellCap herbivores AND cellCap
     carnivores. Sharing one pot made predators compete with their own prey
     for standing room: a hunter arriving at an occupied cell had to evict
     one of the two animals it came to eat, and grazers were pushed off good
     grass by competitors that never touch grass. Per-diet counting keeps
     territory a contest among ecological equals and leaves predation a
     purely trophic interaction. false restores the shared pot. */
  patchRange: 12,
  patchSill: 1.0,
  growLo: 0.02,           // mean of growLo and growHi is 0.10: the old
  growHi: 0.18,           // uniform rate, now spread across the map
  mutationP: 0.05,
  moveCostPer: 0.1,       // fat per unit distance moved
  bodyCostPer: 0.1,       // fat per unit of basal tissue per step
  eyeCost: 1.0,           // how much one unit of eye counts toward basal
                          // upkeep, relative to a unit of leg or body.
                          // Joe, 2026-08-28: sensory tissue was the one
                          // free component, and once territory contests
                          // scored on L+B+M+E, selection inflated eyes to
                          // win pixels at no cost (measured: E 1 -> 3.6).
                          // Real retinas are expensive; so are these.
  starveBelow: 1,
  babyFat: 2,             // DECISION: newborn's starting fat
  initFat: 8,             // founders arrive fed but not rich
  /* Founding NUMBERS are drawn per species, not fixed (Joe, 2026-08-28):
     founder density turned out to matter as much as founder traits - in the
     first guild batch the worlds that kept their predators had started with
     46 carnivores on average against 13 for the two that lost them. Drawing
     the counts makes every world an independent sample of that variable
     instead of repeating one recipe. herbPerSpecies/carnPerSpecies remain
     as the fallback when a founder arrives without a count of its own. */
  herbCountLo: 5,  herbCountHi: 40,
  carnCountLo: 2,  carnCountHi: 20,
  herbPerSpecies: 20,     // fallback individuals per founding herbivore
  carnPerSpecies: 10,     // ... and per founding carnivore
  foundersPer: 10,        // fallback when a founder gives no count
  founders: null,         // explicit founder list, or null to draw at random

  /* --- the three risk-tolerance parameters ----------------------------- */
  reproReserveSteps: 15,  // keep 15 steps of body metabolism before breeding
  dangerWeight: 6.0,      // fear of a predator standing on your cell
  braveryFloor: 0.25,     // a starving animal keeps only this fraction of it
  mateWeight: 3.0,        // pull of a visible eligible mate

  /* MATE-SEEKING AS A DRIVE (Joe, 2026-08-28). It used to be gated hard on
     affordability: an animal one crumb short of a litter had literally zero
     interest in its own kind, then full interest a step later. Hunger has
     never worked that way - it is a deficit that grows - and neither should
     this. Now the urge rises with how close to ready an animal is, so it
     starts CLOSING on a partner before it can pay, and grows further the
     longer it goes unmated. Rare species benefit most, which is exactly the
     Allee relief a new carnivore lineage needs: it can no longer be true
     that the only two carnivores in the world ignore each other because
     neither has quite finished eating.
     Actually spending fat on offspring still requires affordability - this
     changes who walks toward whom, not who can pay. */
  mateUrgeSteps: 120,     // unmated steps at which loneliness saturates
  mateUrgeLonely: 2.0,    // multiplier on the urge when fully lonely
  carnMateBoost: 1.0,     // extra weight for carnivores specifically

  /* QUESTING (Joe, 2026-08-28). An animal carrying enough fat for
     questLitters offspring has nothing left to gain by grazing and
     everything to gain by finding a partner, so it stops foraging and
     TRAVELS - holding one heading for questHold steps instead of milling
     about inside its own perception radius. Waiting is what kept rare
     species rare; this gives a rich animal a way to solve its own Allee
     problem.

     OFF BY DEFAULT (Joe, 2026-08-28, after watching a run): set
     questLitters to 0 and both the questing behaviour AND its raised
     appetite ceiling revert exactly to the pre-quest model - animals stop
     eating at 1.3x their breeding threshold again, instead of hoarding
     five litters' worth of conspicuous fat. Set it to 5 to switch the
     whole mechanism back on. */
  questLitters: 0,        // litters' worth of spare fat that triggers it;
                          // 0 disables questing entirely
  questBoost:   3.0,      // multiplier on mate attraction while questing
  questDrive:   2.5,      // pull of the chosen heading when no kin in sight
  questHold:    25,       // steps a heading is kept before re-drawing

  comfortSteps: 25,       // fat giving 25 steps of body burn = "comfortable";
                          // hunger is judged against this horizon

  /* --- diet is part of species identity ------------------------------- */
  dietAssort: true,       // mates must share a diet. Joe's ruling: the
                          // species key, the table and the phylogeny all
                          // treat a carnivore as a different species from
                          // its herbivore trait-twin; mating agrees now.
                          // Also the fix for the gene-dilution leak that
                          // kept predators rare (measured: end-state
                          // carnivores 23-33 vs 3-14 when cross-diet
                          // mating was allowed). false restores the old
                          // behaviour for comparison runs.
  maxAnimals: 20000,      // engine safety valve, far above any balanced run
};

/* EIGHT founder species with random traits: a grazer and a hunter for each
   corner (Joe, 2026-08-28). Seeding predators at t0 rather than waiting for
   a diet-flip mutant to solve its own Allee problem is the only reliable
   way to get a functioning predator guild - measured repeatedly.

   Each trait is uniform 1..6, low enough that evolution can go both ways.
   The corner's hunter is drawn with a mouth that EXCEEDS its neighbour
   grazer's body, because a carnivore that cannot open its jaws wide enough
   for the only prey in reach is dead on arrival, and a founder should at
   least be viable. Duplicate trait vectors re-roll so every population
   starts reproductively distinct. */
function randomFounders(rnd, P){
  const out=[], seen=new Set();
  const draw=()=>1+Math.floor(rnd()*6);
  const cnt=(lo,hi)=>lo+Math.floor(rnd()*(hi-lo+1));
  for(let c=0;c<4;c++){
    let herb;
    do { herb={ name:'grazer'+(c+1), legs:draw(), body:draw(),
                mouth:draw(), eyes:draw(), carn:false,
                count:cnt(P.herbCountLo, P.herbCountHi) };
    } while(seen.has(herb.legs+','+herb.body+','+herb.mouth+','+herb.eyes));
    seen.add(herb.legs+','+herb.body+','+herb.mouth+','+herb.eyes);
    let carn;
    do { carn={ name:'hunter'+(c+1), legs:draw(), body:draw(),
                mouth:Math.min(10, herb.body+1+Math.floor(rnd()*4)),
                eyes:draw(), carn:true,
                count:cnt(P.carnCountLo, P.carnCountHi) };
    } while(seen.has(carn.legs+','+carn.body+','+carn.mouth+','+carn.eyes));
    seen.add(carn.legs+','+carn.body+','+carn.mouth+','+carn.eyes);
    out.push(herb, carn);
  }
  return out;
}

function key(a){ return a.legs+','+a.body+','+a.mouth+','+a.eyes+(a.carn?'C':'H'); }

/* ---- the growth-quality field -------------------------------------------
   White noise smoothed by repeated box blurs. Three passes of a box kernel
   approximate a Gaussian, so the result is a random field with an
   approximately Gaussian covariance whose range is set by patchRange - the
   cheap standard way to get spatial autocorrelation without a covariance
   matrix. Normalised to [0,1] across the realised min/max so every world
   uses the full quality span, then pulled toward the mean by (1 - sill).  */
function buildQuality(P, rnd){
  const N=P.W*P.H;
  let a=new Float32Array(N), b=new Float32Array(N);
  for(let i=0;i<N;i++) a[i]=rnd();
  const r=Math.max(1, Math.round(P.patchRange/3));
  for(let pass=0; pass<3; pass++){
    // horizontal box blur
    for(let y=0;y<P.H;y++){
      const row=y*P.W;
      for(let x=0;x<P.W;x++){
        let s=0,n=0;
        for(let d=-r;d<=r;d++){ const xx=x+d; if(xx<0||xx>=P.W) continue; s+=a[row+xx]; n++; }
        b[row+x]=s/n;
      }
    }
    // vertical box blur
    for(let x=0;x<P.W;x++){
      for(let y=0;y<P.H;y++){
        let s=0,n=0;
        for(let d=-r;d<=r;d++){ const yy=y+d; if(yy<0||yy>=P.H) continue; s+=b[yy*P.W+x]; n++; }
        a[y*P.W+x]=s/n;
      }
    }
  }
  let lo=Infinity, hi=-Infinity;
  for(let i=0;i<N;i++){ if(a[i]<lo) lo=a[i]; if(a[i]>hi) hi=a[i]; }
  const span=Math.max(1e-9, hi-lo), s=P.patchSill;
  for(let i=0;i<N;i++){
    const q=(a[i]-lo)/span;
    a[i]=0.5 + s*(q-0.5);           // sill 0 = uniform land, 1 = full spread
  }
  return a;
}

function newWorld(seed, opts){
  const P = Object.assign({}, DEFAULTS, opts||{});
  const rnd = mulberry32(seed|0);
  const grass = new Float32Array(P.W*P.H).fill(P.grassInit);
  const quality = buildQuality(P, rnd);
  const w = { P, rnd, grass, quality, animals:[], step:0, nextId:1,
              births:0, starved:0, eaten:0, mutants:0,
              carnFlips:0, carnBorn:0, carnStarved:0, carnAgeSum:0, evictions:0,
              preyLog:new Map(),   // predator species -> prey species -> kills
              /* the phylogeny record: every mutant birth is a speciation
                 EVENT - child species, parent species, when. A consumer
                 (the lab runner) drains this with splice(0); if nobody
                 drains it, the cap keeps an unwatched wall run bounded. */
              emergences:[],
              log:[] };
  /* Founders may be supplied explicitly (the lab's setup panel does this):
     each entry may carry legs/body/mouth/eyes, a carn flag, and a count.
     Anything omitted falls back to the random draw. */
  w.founders = (P.founders && P.founders.length) ? P.founders : randomFounders(rnd, P);
  /* Founders scatter within an 18x18 patch in a corner; with eight
     populations the corners take two apiece, so each hunter starts in the
     same country as a grazer it can actually eat. */
  const corners=[[0,0],[P.W-18,0],[0,P.H-18],[P.W-18,P.H-18]];
  w.founders.forEach((sp,i)=>{
    const [cx,cy]=corners[i%4];
    const many = (sp.count!==undefined) ? sp.count
               : (sp.carn ? P.carnPerSpecies : P.herbPerSpecies);
    for(let k=0;k<many;k++){
      /* founders respect the cap too - retry a few times for an open cell */
      let px=0, py=0;
      for(let tries=0; tries<40; tries++){
        px=cx+Math.floor(rnd()*18); py=cy+Math.floor(rnd()*18);
        let n=0; for(const b of w.animals) if(b.x===px&&b.y===py) n++;
        if(n<P.cellCap) break;
      }
      w.animals.push({ id:w.nextId++, x:px, y:py,
        legs:sp.legs, body:sp.body, mouth:sp.mouth, eyes:sp.eyes,
        fat:P.initFat, carn:!!sp.carn, age:0, moved:0,
        founder:sp.name||('corner'+(i+1)) });
    }
  });
  return w;
}

/* ---- perception helpers --------------------------------------------------
   Everything an animal decides is computed from what sits within eyes cells
   of it. The cell index is rebuilt once per step and shared. */
function buildIndex(w){
  /* A FLAT ARRAY, not a Map: perception does ~1e6 cell lookups per step at
     equilibrium and array indexing is markedly cheaper than Map.get.
     Per-cell insertion order is unchanged, so runs stay bit-identical
     (verified by fingerprint before/after). */
  const idx = new Array(w.P.W*w.P.H);
  for(const a of w.animals){ if(a.dead) continue;
    const k=a.y*w.P.W+a.x;
    const arr=idx[k]; if(arr) arr.push(a); else idx[k]=[a];
  }
  return idx;
}
function dist(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return Math.sqrt(dx*dx+dy*dy); }

/* Per-radius offset tables, built once: perception visits only cells truly
   inside the circle, with their distances precomputed - the scan is the
   entire cost of a step at 20,000 animals, so no sqrt in the loop. */
const OFFS=[];
for(let R=0;R<=10;R++){
  const list=[];
  for(let dy=-R;dy<=R;dy++) for(let dx=-R;dx<=R;dx++){
    const d=Math.sqrt(dx*dx+dy*dy);
    if(d<=R) list.push({dx,dy,d});
  }
  OFFS.push(list);
}

/* What this animal can see: the best grass cells, every visible animal
   split into prey / eligible mates / predators-of-me. */
function perceive(w, a, idx){
  const P=w.P, R=a.eyes, out={ grassSpots:[], prey:[], mates:[], kin:[], predators:[] };
  for(const o of OFFS[R]){
    const x=a.x+o.dx, y=a.y+o.dy;
    if(x<0||y<0||x>=P.W||y>=P.H) continue;
    const d=o.d;
    if(!a.carn){
      const g=w.grass[y*P.W+x];
      if(g>=1){
        /* TOP-6 BY INSERTION, not sort-then-truncate. Every herbivore sees
           up to ~80 grass cells and only the best 6 survive; sorting all of
           them per animal per step was the single hottest operation in the
           model. Insert after all entries with score >= this one, which is
           exactly what a STABLE descending sort produced - verified
           bit-identical. Cells that cannot reach the top 6 never allocate. */
        const v=Math.min(a.mouth,g), sc=v/(1+d), arr=out.grassSpots;
        if(arr.length<6 || sc>arr[arr.length-1]._s){
          let i=arr.length-1;
          while(i>=0 && sc>arr[i]._s) i--;
          arr.splice(i+1, 0, {x,y,d,v,_s:sc});
          if(arr.length>6) arr.length=6;
        }
      }
    }
    const cell=idx[y*P.W+x]; if(!cell) continue;
    for(const b of cell){ if(b===a||b.dead) continue;
      if(a.carn && a.mouth>b.body) out.prey.push({b,x,y,d});
      if(b.carn && b.mouth>a.body) out.predators.push({b,x,y,d});
      if(b.legs===a.legs && b.body===a.body && b.mouth===a.mouth && b.eyes===a.eyes
         && (!P.dietAssort || b.carn===a.carn)){
        /* kin are worth walking toward even when neither side is ready yet -
           losing sight of your own species is how a corner population goes
           reproductively extinct at fixed count (measured: three of four
           founder species froze for 2,000 steps before this existed) */
        out.kin.push({b,x,y,d});
        if(reproReady(w,b)>0) out.mates.push({b,x,y,d});
      }
    }
  }
  /* grassSpots is already the best 6, kept in order as it was built */
  out.prey.sort((p,q)=>(preyValue(q.b)/(1+q.d))-(preyValue(p.b)/(1+p.d)));
  out.prey.length=Math.min(out.prey.length,6);
  return out;
}
function preyValue(b){ return b.legs+b.body+b.fat; }

/* BASAL RATE (Joe, 2026-08-28): upkeep is charged on legs + body, not body
   alone - locomotor tissue costs something to carry even when standing
   still. Floored at 1 so nothing is free to exist. Every "steps of
   metabolism" quantity (hunger horizon, breeding reserve) reads this same
   function, so they cannot drift apart from what is actually burned. */
function basal(a, P){ return Math.max(1, a.legs+a.body+(P?P.eyeCost:1)*a.eyes); }

/* what territory contests are settled on: metabolically-paid tissue, plus
   mouth at whatever weight the world gives it (default 0) */
function sizeOf(a,P){ return a.legs+a.body+a.eyes+(P?P.sizeMouth:0)*a.mouth; }

/* Can `a` occupy (x,y)? Returns null if not, otherwise the animal that must
   be evicted first (or undefined when there is simply room). The index is
   kept live through the step, so this sees moves already made this turn. */
function entryFor(w, idx, a, x, y){
  const cell=idx[y*w.P.W+x];
  if(!cell) return { evict:null };
  /* Count only the LIVING (an animal eaten earlier this step has left a
     vacancy) and, when capPerDiet is on, only one's own trophic guild -
     grazers contest ground with grazers, hunters with hunters. */
  const perDiet=w.P.capPerDiet;
  let live=0, weakest=null;
  for(const b of cell){
    if(b===a) return { evict:null };                 // already standing here
    if(b.dead) continue;
    if(perDiet && b.carn!==a.carn) continue;
    live++;
    if(!weakest || sizeOf(b,w.P)<sizeOf(weakest,w.P)) weakest=b;
  }
  if(live<w.P.cellCap) return { evict:null };
  return (weakest && sizeOf(a,w.P)>sizeOf(weakest,w.P)) ? { evict:weakest } : null;
}

/* Move an animal between cells, keeping the live index correct. */
function relocate(w, idx, a, nx, ny){
  const from=idx[a.y*w.P.W+a.x];
  if(from){ const i=from.indexOf(a); if(i>=0) from.splice(i,1); }
  a.x=nx; a.y=ny;
  const k=ny*w.P.W+nx;
  if(idx[k]) idx[k].push(a); else idx[k]=[a];
}

/* Somewhere with room within `rad` of (x,y), nearest rings first - used for
   evicted animals and for newborns when the parents' cell is full. */
function freeCellNear(w, idx, x, y, rad, carn){
  const perDiet=w.P.capPerDiet;
  for(let r=1;r<=rad;r++){
    for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
      const nx=x+dx, ny=y+dy;
      if(nx<0||ny<0||nx>=w.P.W||ny>=w.P.H) continue;
      const c=idx[ny*w.P.W+nx];
      if(!c) return {x:nx,y:ny};
      let live=0;
      for(const b of c){ if(b.dead) continue;
        if(perDiet && b.carn!==carn) continue; live++; }
      if(live<w.P.cellCap) return {x:nx,y:ny};
    }
  }
  return null;
}
/* Trophic conversion: what fraction of a kill becomes predator fat.
   Linear in the predator's sensory-locomotor investment (Joe's rule):
   eyes+legs = 0 -> 0.9, eyes+legs = 20 -> 0.1. */
function convEff(a){ return 0.9 - 0.04*(a.eyes+a.legs); }

/* Joe's concealment rule: the prey's size S = legs+body+mouth+fat against
   the grass on the cell it stands in. Hidden (grass >= S): 10%. Exposed:
   rises linearly to 100% on bare ground. */
function catchProb(w,prey){
  const S=prey.legs+prey.body+prey.fat;
  const g=w.grass[prey.y*w.P.W+prey.x];
  return g>=S ? 0.10 : 1 - 0.9*(g/Math.max(S,1e-9));
}
/* the same exposure, evaluated for ME if I stood at (px,py) - what fear
   and hiding decisions are made of */
function exposureAt(w,a,px,py){
  const S=a.legs+a.body+a.fat;
  const g=w.grass[py*w.P.W+px];
  return g>=S ? 0.10 : 1 - 0.9*(g/Math.max(S,1e-9));
}

/* Hunger runs 0 (comfortable) to 1 (about to starve), judged against a
   horizon of comfortSteps of body metabolism. */
function hunger(w,a){
  const comfort = w.P.starveBelow + w.P.comfortSteps*w.P.bodyCostPer*basal(a,w.P);
  return Math.max(0, Math.min(1, (comfort-a.fat)/(comfort-w.P.starveBelow) ));
}
/* Reproduction economics. The spec's gate: fat must exceed the build cost
   legs+body+mouth. The reserve (risk parameter 1) is what the parent keeps
   FOR ITSELF after paying its half-share: enough fat to survive
   reproReserveSteps of body metabolism. Readiness therefore means "one
   litter is affordable right now" - the larger of the spec gate and
   half-share + reserve. (An earlier form re-applied the whole readiness
   threshold after payment; every animal sat ready and adjacent and no pair
   could ever afford baby one - measured, four species, 2,000 frozen steps.) */
function litterShare(w,a){ return (a.legs+a.body+a.mouth+w.P.babyFat)/2; }
function reserveFloor(w,a){
  return w.P.starveBelow + w.P.reproReserveSteps*w.P.bodyCostPer*basal(a,w.P);
}
function reproThreshold(w,a){
  return Math.max(a.legs+a.body+a.mouth, litterShare(w,a)+reserveFloor(w,a));
}
/* 0..1 desire to be near a mate: mostly "how close am I to affording a
   litter", amplified by how long it has been. Deliberately quadratic so a
   half-provisioned animal is only mildly interested. */
function mateUrge(w,a,h){
  /* SURVIVAL FIRST. The old hard gate (r>0) implicitly guaranteed the
     animal had surplus fat before it could care about mates. Replacing it
     with a proximity ramp removed that guarantee, and a first cut without
     this hunger term emptied every world in 6,000 steps: animals courted
     instead of eating and starved in company (measured - populations of 3).
     Multiplying by (1-hunger) restores the priority - a hungry animal has
     no interest in romance - while still letting a merely-peckish one
     start closing on a partner before it can pay. */
  const t=reproThreshold(w,a);
  const prox=Math.min(1, a.fat/Math.max(1e-9,t));
  const lonely=Math.min(1, (a.sinceMate||0)/w.P.mateUrgeSteps);
  const amp=1 + (w.P.mateUrgeLonely-1)*lonely;
  const hg=(h===undefined)?hunger(w,a):h;
  return prox*prox*amp*Math.max(0,1-hg)*(a.carn ? w.P.carnMateBoost : 1);
}

function reproReady(w,a){
  const t=reproThreshold(w,a);
  return a.fat<=t ? 0 : Math.min(1,(a.fat-t)/t);
}

/* Fear of a spot: every visible predator repels it, nearer ones more.
   A starving animal keeps only braveryFloor of its fear (risk parameter 2):
   certain starvation outweighs possible predation. */
function fearAt(w, a, px, py, predators, h){
  if(!predators.length) return 0;
  let f=0;
  for(const p of predators) f += 1/(1+dist(px,py,p.b.x,p.b.y));
  const brave = w.P.braveryFloor + (1-w.P.braveryFloor)*(1-h);
  /* concealment scales the threat: the same predator two cells away is
     background noise from tall grass and a death sentence on bare dirt -
     which is exactly what sends hunted herbivores diving into cover */
  return f * exposureAt(w,a,px,py) * w.P.dangerWeight * brave;
}

/* ---- one animal's decision ----------------------------------------------
   Score the reachable options and take the best:
     - eat here (grass or a catchable animal on this cell)
     - mate here (eligible partner on this or an adjacent cell)
     - move to one of the sampled destinations within legs distance,
       valued by the food/mates it approaches minus the fear it walks into
       minus the fat the walk itself burns.                              */
function act(w, a, idx){
  /* idx is LIVE this step: moves and evictions update it as they happen, so
     occupancy decisions are made against the true current state. */
  const P=w.P, see=perceive(w,a,idx), h=hunger(w,a), r=reproReady(w,a);
  /* Appetite serves two masters. Survival hunger h (0..1) prices a meal at
     full weight. Breeding appetite keeps an animal eating past comfort
     until fat clears ~130% of its reproduction threshold - satiety pinned
     to the SURVIVAL horizon alone froze the whole world at fat ~9 with
     zero births in every seed (measured). The 0.6 weight keeps ambition
     gentler than starvation, so fear can override one but barely dents
     the other. */
  /* Appetite now aims at the QUEST purse, not merely at one affordable
     litter: an animal eats until it is rich enough to go looking for a
     mate, then stops. (With the old 1.3x-threshold ceiling nobody could
     ever save five litters' worth, so questing never fired once in 9,000
     steps - measured.) The saving is not free: fat is in the concealment
     term, so a questing animal is a conspicuous one. */
  /* Appetite aims at the quest purse when questing is enabled, and
     otherwise at the old satiety ceiling of 1.3x the breeding threshold.
     One switch (questLitters) therefore governs both the behaviour and the
     hoarding it requires - they cannot get out of step. */
  const questAt = P.questLitters>0
        ? reproThreshold(w,a)+P.questLitters*litterShare(w,a)
        : reproThreshold(w,a)*1.3;
  const drive=Math.max(h, 0.6*Math.max(0, 1-a.fat/questAt));

  /* THE QUEST. Fat enough for questLitters offspring and still no partner
     in sight: stop grazing, pick a bearing, and go. The heading persists
     (questHold steps) so the animal actually crosses ground instead of
     random-walking on the spot - which is the difference between searching
     and milling. */
  const questing = P.questLitters>0 && r>0 && a.fat >= questAt;
  if(questing){
    if(a.qt===undefined || a.qt<=0){ a.qdir=w.rnd()*Math.PI*2; a.qt=P.questHold; }
    a.qt--;
  } else a.qt=0;

  /* candidate destinations: stay, plus legs-radius points on 16 bearings
     at full and half stride. Integer cells, deduplicated. */
  const cands=[{x:a.x,y:a.y,d:0}];
  if(a.legs>0){
    /* seen-set instead of a linear scan per candidate: same candidates in
       the same order, but O(n) instead of O(n^2) on a 33-entry list that
       every animal rebuilds every step */
    const seen=new Set([a.y*P.W+a.x]);
    for(let k=0;k<16;k++){
      const th=k*Math.PI/8;
      for(const frac of [1,0.5]){
        const dr=a.legs*frac; if(dr<1) continue;
        const nx=Math.round(a.x+Math.cos(th)*dr), ny=Math.round(a.y+Math.sin(th)*dr);
        if(nx<0||ny<0||nx>=P.W||ny>=P.H) continue;
        const ck=ny*P.W+nx; if(seen.has(ck)) continue;
        const dd=dist(a.x,a.y,nx,ny);
        /* only offer destinations it could actually take - a full cell it
           cannot out-size is not a candidate at all */
        if(dd<=a.legs+1e-9 && entryFor(w,idx,a,nx,ny)){
          seen.add(ck); cands.push({x:nx,y:ny,d:dd});
        }
      }
    }
  }

  /* immediate actions on the current cell */
  let best={ kind:'stay', score:-1e9 };
  if(!a.carn){
    const g=w.grass[a.y*P.W+a.x];
    const gain=Math.min(a.mouth,g);
    if(gain>0 && drive>0){
      /* hunger alone prices a meal: a comfortable animal does not eat, so
         fat is bounded near the comfort horizon and grazing pressure tracks
         real metabolic need instead of hoarding without limit */
      const s = drive*gain - fearAt(w,a,a.x,a.y,see.predators,h);
      if(s>best.score) best={kind:'graze', score:s, gain};
    }
  } else {
    const here=see.prey.filter(p=>p.d===0 && !p.b.dead);
    if(here.length){
      const tgt=here[0];
      const s=drive*catchProb(w,tgt.b)*convEff(a)*preyValue(tgt.b) - fearAt(w,a,a.x,a.y,see.predators,h);
      if(s>best.score) best={kind:'hunt', score:s, target:tgt.b};
    }
  }
  if(r>0){
    const near=see.mates.filter(m=>m.d<=1.5 && !m.b.acted && !m.b.dead);
    if(near.length){
      /* mating outranks a meal whenever both are possible and the animal is
         ready - the mateWeight scale (risk parameter 3) is what let it walk
         here through fear in earlier steps */
      const s = P.mateWeight*(1+r)*2 - fearAt(w,a,a.x,a.y,see.predators,h);
      if(s>best.score) best={kind:'mate', score:s, partner:near[0].b};
    }
  }

  /* movement options */
  for(const c of cands){
    let v=0;
    if(!a.carn){ for(const g of see.grassSpots) v=Math.max(v,drive*g.v/(1+dist(c.x,c.y,g.x,g.y))); }
    else       { for(const p of see.prey)      v=Math.max(v,drive*catchProb(w,p.b)*convEff(a)*preyValue(p.b)/(1+dist(c.x,c.y,p.x,p.y))); }
    let mv=0;
    const mw=P.mateWeight*(questing?P.questBoost:1);
    /* LOCAL attraction stays gated on actual readiness r. Driving it with
       the (much larger) urge instead emptied every world: a fed animal's
       food score falls to ~0 by satiety, so an always-on kin pull became
       the strongest term in the movement score, herds collapsed onto each
       other, and with two animals to a cell they milled instead of grazing
       and starved in company. Bisected: this one line, 5,028 animals vs 3.
       The urge earns its keep in the SEARCH rule below instead, where it
       moves lonely animals that can see no kin at all - which is the case
       a rare lineage is actually in. */
    if(r>0) for(const m of see.kin) mv=Math.max(mv, mw*r/(1+dist(c.x,c.y,m.x,m.y)));
    /* nothing of its own kind in view: travel the chosen bearing, and
       prefer a long stride along it to a short one */
    if(questing && !see.kin.length && a.legs>0 && c.d>0){
      const dx=c.x-a.x, dy=c.y-a.y, len=Math.hypot(dx,dy);
      const dot=(dx*Math.cos(a.qdir)+dy*Math.sin(a.qdir))/len;
      if(dot>0) mv=Math.max(mv, P.questDrive*dot*(len/Math.max(1,a.legs)));
    }
    const s = v + mv - fearAt(w,a,c.x,c.y,see.predators,h) - P.moveCostPer*c.d;
    if(s>best.score) best={kind:'move', score:s, to:c};
  }

  /* An animal whose needs cannot be answered by anything in sight WANDERS
     instead of standing still: hungry with no grass in view, or ready to
     breed with no kin in view. Without this, an isolated animal is a
     statue, and reunion of a scattered species is impossible. */
  if(best.score<=1e-6 && a.legs>0 && cands.length>1 &&
     ( (drive>0.2 && (a.carn? !see.prey.length : !see.grassSpots.length)) ||
       (mateUrge(w,a,h)>0.35 && !see.kin.length) )){
    best={kind:'move', score:0, to:cands[1+Math.floor(w.rnd()*(cands.length-1))]};
  }

  /* ---- execute ---- */
  a.moved=0;
  if(best.kind==='graze'){
    const i=a.y*P.W+a.x;
    w.grass[i]=Math.max(0,w.grass[i]-best.gain);
    a.fat+=best.gain;
  } else if(best.kind==='hunt'){
    if(w.rnd()<catchProb(w,best.target)){
      best.target.dead='eaten'; w.eaten++;
      a.fat+=convEff(a)*preyValue(best.target);
      /* the diet ledger: what does each carnivore species actually eat */
      const pk=key(a), qk=key(best.target);
      let m=w.preyLog.get(pk); if(!m){ m=new Map(); w.preyLog.set(pk,m); }
      m.set(qk,(m.get(qk)||0)+1);
    }
  } else if(best.kind==='mate'){
    mate(w, a, best.partner, idx);
  } else if(best.kind==='move' && best.to.d>0){
    const e=entryFor(w,idx,a,best.to.x,best.to.y);
    if(e){
      if(e.evict){
        /* take the pixel: the smaller resident is pushed to the nearest
           cell with room. If the map around it is full the contest simply
           fails and the challenger stays put - no animal is deleted by a
           territorial loss. */
        const spot=freeCellNear(w,idx,best.to.x,best.to.y,3,e.evict.carn);
        if(spot){ relocate(w,idx,e.evict,spot.x,spot.y); w.evictions++; }
        else { a.acted=true; return; }
      }
      relocate(w,idx,a,best.to.x,best.to.y);
      a.moved=best.to.d;
    }
  }
  a.acted=true;
}

/* Mating: both partners spend their action; babies keep coming while both
   parents stay above their own reserve threshold. */
function mate(w, mom, dad, idx){
  const P=w.P;
  dad.acted=true;
  const build=mom.legs+mom.body+mom.mouth;                 // equal traits: same cost
  const perParent=(build+P.babyFat)/2;
  let made=0;
  /* per baby: the spec gate (fat above build cost) AND the reserve floor
     (survive reproReserveSteps after paying) must hold for both parents */
  while(mom.fat>build && dad.fat>build &&
        mom.fat-perParent>=reserveFloor(w,mom) &&
        dad.fat-perParent>=reserveFloor(w,dad) &&
        w.animals.length+madeQueue.length<P.maxAnimals){
    /* Parents share a diet, so the offspring's guild is known before it
       exists - which is what the per-diet slot search needs. */
    const baby0carn = mom.carn;
    /* The newborn needs a slot: the parents' own cell if it has room,
       otherwise a free cell within the MOTHER'S LEG REACH (Joe,
       2026-08-28) - dispersal distance is inherited machinery, so a
       sessile L0 pair can only breed into their own pixel while a
       long-legged one can seed a neighbourhood. A pair holding a full
       pixel with no reachable vacancy simply cannot place the offspring,
       so territory limits reproduction directly. */
    let spot = null;
    const home=idx[mom.y*P.W+mom.x];
    let liveHome=0;
    if(home) for(const b of home){ if(b.dead) continue;
      if(P.capPerDiet && b.carn!==baby0carn) continue; liveHome++; }
    if(liveHome<P.cellCap) spot={x:mom.x,y:mom.y};
    else spot=freeCellNear(w,idx,mom.x,mom.y,mom.legs,baby0carn);
    if(!spot) break;
    mom.fat-=perParent; dad.fat-=perParent;
    const baby={ id:w.nextId++, x:spot.x, y:spot.y,
      legs:mom.legs, body:mom.body, mouth:mom.mouth, eyes:mom.eyes,
      fat:P.babyFat, carn:(w.rnd()<0.5?mom:dad).carn, age:0, moved:0,
      founder:mom.founder };
    if(w.rnd()<P.mutationP){
      w.mutants++;
      const pick=Math.floor(w.rnd()*5);
      if(pick===4){ baby.carn=!baby.carn; if(baby.carn) w.carnFlips++; }
      else{
        const t=['legs','body','mouth','eyes'][pick];
        const lo=(t==='body'||t==='mouth')?1:0;    // the trait floors
        baby[t]=Math.max(lo,Math.min(10,baby[t]+(w.rnd()<0.5?-1:1)));
      }
      const ck=key(baby);
      if(ck!==key(mom)){
        w.emergences.push({step:w.step, child:ck, parent:key(mom)});
        if(w.emergences.length>5000) w.emergences.shift();
      }
    }
    const bk=spot.y*P.W+spot.x;
    if(idx[bk]) idx[bk].push(baby); else idx[bk]=[baby];
    mom.sinceMate=0; dad.sinceMate=0;
    madeQueue.push(baby); made++; w.births++; if(baby.carn) w.carnBorn++;
    if(made>=6) break;   // engine guard: one pair, one step, six births max
  }
}
let madeQueue=[];

/* ---- one world step ------------------------------------------------------ */
function step(w){
  const P=w.P;
  /* Grass first, and now the land differs: each cell's quality q sets both
     its compounding rate (growLo..growHi) and how fast it re-sprouts from
     bare. Good patches recover quickly and stand tall; poor patches are
     nearly barren. This is what makes a pixel worth defending. */
  const base=1/P.regrowEvery, lo=P.growLo, hi=P.growHi;
  for(let i=0;i<w.grass.length;i++){
    const q=w.quality[i], rate=lo+(hi-lo)*q;
    const g=w.grass[i];
    w.grass[i] = g<1 ? Math.min(1, g + base*(0.2+0.8*q))
                     : Math.min(P.grassMax, g*(1+rate));
  }
  /* animals act in a fresh random order every step - a fixed order would
     hand the same animals first pick of grass and mates forever */
  const order=w.animals.filter(a=>!a.dead);
  for(let i=order.length-1;i>0;i--){ const j=Math.floor(w.rnd()*(i+1));
    [order[i],order[j]]=[order[j],order[i]]; }
  const idx=buildIndex(w);
  madeQueue=[];
  for(const a of order){ a.acted=false; }
  for(const a of order){ if(a.dead||a.acted) continue; act(w,a,idx); }
  /* metabolism + death, then the newborns join */
  for(const a of order){
    if(a.dead) continue;
    /* basal floor: metabolism charges at least one body unit - a body-0
       animal still runs its machinery. Without this, mouth-fed grazing
       made B0 a zero-upkeep body plan and two of three test seeds hit the
       population cap on it (measured). */
    a.fat -= P.moveCostPer*a.moved + P.bodyCostPer*basal(a,P);
    a.age++;
    a.sinceMate=(a.sinceMate||0)+1;
    if(a.fat<P.starveBelow){ a.dead='starved'; w.starved++;
      if(a.carn){ w.carnStarved++; w.carnAgeSum+=a.age; } }
  }
  w.animals=w.animals.filter(a=>!a.dead).concat(madeQueue);
  w.step++;
}

/* ---- observation --------------------------------------------------------- */
function stats(w){
  const sp=new Map(); let herb=0,carn=0,fat=0;
  for(const a of w.animals){
    sp.set(key(a),(sp.get(key(a))||0)+1);
    if(a.carn)carn++; else herb++;
    fat+=a.fat;
  }
  let g=0, gCells=0;
  for(let i=0;i<w.grass.length;i++){ g+=w.grass[i]; if(w.grass[i]>=1) gCells++; }
  const list=[...sp.entries()].sort((a,b)=>b[1]-a[1]).map(([k,count])=>{
    const carn=k.endsWith('C'), t=k.slice(0,-1).split(',').map(Number);
    const e={ key:k, count, carn, legs:t[0], body:t[1], mouth:t[2], eyes:t[3] };
    if(carn){
      const m=w.preyLog.get(k);
      if(m) e.preyTop=[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,2);
    }
    return e;
  });
  return { step:w.step, animals:w.animals.length, herb, carn,
           species:sp.size, grass:Math.round(g),
           grassPerCell:+(g/w.grass.length).toFixed(2),
           vegetatedPct:Math.round(100*gCells/w.grass.length),
           births:w.births, starved:w.starved, eaten:w.eaten, mutants:w.mutants,
           evictions:w.evictions,
           carnFlips:w.carnFlips, carnBorn:w.carnBorn, carnStarved:w.carnStarved,
           carnMeanAge: w.carnStarved? +(w.carnAgeSum/w.carnStarved).toFixed(1):0,
           fatMean: w.animals.length? +(fat/w.animals.length).toFixed(2) : 0,
           list,
           topSpecies: [...sp.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5) };
}

global.Eco = { newWorld, step, stats, DEFAULTS, key };
})(typeof window!=='undefined' ? window : globalThis);
