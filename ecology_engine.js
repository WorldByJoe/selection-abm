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
   EAT grass (gains min(body, grass here), always succeeds), EAT an animal
   in the same cell (needs mouth >= prey body; gains prey legs + body +
   fat), or MATE. PREDATION SUCCESS DEPENDS ON HIDING IN THE GRASS (Joe,
   2026-08-28, replacing the original flat 50%): with S = the prey's
   legs+body+mouth+fat, a prey standing in grass >= S is caught only 10% of
   the time; below that, success rises linearly to 100% on bare ground. So
   an overgrazed commons is a killing field, fat itself is a visibility
   cost, and tall grass is worth fighting over.

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
   mouth or eyes shifts +-1 (clamped to 0..10), or the diet flips between
   herbivore and carnivore.

   PERCEPTION: an animal sees everything within eyes cells of itself -
   grass, animals, and their trait values - and chooses its action to
   satisfy eating, reproduction, and predator avoidance.

   METABOLISM: each step fat falls by 0.1 x (distance moved) + 0.1 x body.
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
  mutationP: 0.05,
  moveCostPer: 0.1,       // fat per unit distance moved
  bodyCostPer: 0.1,       // fat per unit body per step
  starveBelow: 1,
  babyFat: 2,             // DECISION: newborn's starting fat
  initFat: 8,             // founders arrive fed but not rich

  /* --- the three risk-tolerance parameters ----------------------------- */
  reproReserveSteps: 15,  // keep 15 steps of body metabolism before breeding
  dangerWeight: 6.0,      // fear of a predator standing on your cell
  braveryFloor: 0.25,     // a starving animal keeps only this fraction of it
  mateWeight: 3.0,        // pull of a visible eligible mate

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

/* Four founder species with RANDOM traits, drawn per world from the seeded
   RNG (Joe, 2026-08-28 - the fixed hand-picked four are gone). Each trait
   is uniform 1..6: low enough that evolution can go both ways, high enough
   that a founder is not born crippled. Duplicate draws re-roll so the four
   corners start as four distinct breeding populations. */
function randomFounders(rnd){
  const out=[], seen=new Set();
  while(out.length<4){
    const f={ name:'corner'+(out.length+1),
      legs:1+Math.floor(rnd()*6), body:1+Math.floor(rnd()*6),
      mouth:1+Math.floor(rnd()*6), eyes:1+Math.floor(rnd()*6) };
    const k=f.legs+','+f.body+','+f.mouth+','+f.eyes;
    if(seen.has(k)) continue;
    seen.add(k); out.push(f);
  }
  return out;
}

function key(a){ return a.legs+','+a.body+','+a.mouth+','+a.eyes+(a.carn?'C':'H'); }

function newWorld(seed, opts){
  const P = Object.assign({}, DEFAULTS, opts||{});
  const rnd = mulberry32(seed|0);
  const grass = new Float32Array(P.W*P.H).fill(P.grassInit);
  const w = { P, rnd, grass, animals:[], step:0, nextId:1,
              births:0, starved:0, eaten:0, mutants:0,
              carnFlips:0, carnBorn:0, carnStarved:0, carnAgeSum:0,
              preyLog:new Map(),   // predator species -> prey species -> kills
              /* the phylogeny record: every mutant birth is a speciation
                 EVENT - child species, parent species, when. A consumer
                 (the lab runner) drains this with splice(0); if nobody
                 drains it, the cap keeps an unwatched wall run bounded. */
              emergences:[],
              log:[] };
  w.founders = randomFounders(rnd);
  /* ten founders scattered within an 18x18 patch in each corner */
  const corners=[[0,0],[P.W-18,0],[0,P.H-18],[P.W-18,P.H-18]];
  w.founders.forEach((sp,i)=>{
    const [cx,cy]=corners[i];
    for(let k=0;k<10;k++){
      w.animals.push({ id:w.nextId++, x:cx+Math.floor(rnd()*18), y:cy+Math.floor(rnd()*18),
        legs:sp.legs, body:sp.body, mouth:sp.mouth, eyes:sp.eyes,
        fat:P.initFat, carn:false, age:0, moved:0, founder:sp.name });
    }
  });
  return w;
}

/* ---- perception helpers --------------------------------------------------
   Everything an animal decides is computed from what sits within eyes cells
   of it. The cell index is rebuilt once per step and shared. */
function buildIndex(w){
  const idx = new Map();
  for(const a of w.animals){ if(a.dead) continue;
    const k=a.y*w.P.W+a.x;
    let arr=idx.get(k); if(!arr){ arr=[]; idx.set(k,arr); }
    arr.push(a);
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
      if(g>=1) out.grassSpots.push({x,y,d, v:Math.min(a.body,g)});
    }
    const cell=idx.get(y*P.W+x); if(!cell) continue;
    for(const b of cell){ if(b===a||b.dead) continue;
      if(a.carn && a.mouth>=b.body) out.prey.push({b,x,y,d});
      if(b.mouth>=a.body && b.carn) out.predators.push({b,x,y,d});
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
  /* keep only the best handful of food spots - scoring every candidate
     against every visible cell is O(a lot) for no behavioural gain */
  out.grassSpots.sort((p,q)=>(q.v/(1+q.d))-(p.v/(1+p.d)));
  out.grassSpots.length=Math.min(out.grassSpots.length,6);
  out.prey.sort((p,q)=>(preyValue(q.b)/(1+q.d))-(preyValue(p.b)/(1+p.d)));
  out.prey.length=Math.min(out.prey.length,6);
  return out;
}
function preyValue(b){ return b.legs+b.body+b.fat; }
/* Joe's concealment rule: the prey's size S = legs+body+mouth+fat against
   the grass on the cell it stands in. Hidden (grass >= S): 10%. Exposed:
   rises linearly to 100% on bare ground. */
function catchProb(w,prey){
  const S=prey.legs+prey.body+prey.mouth+prey.fat;
  const g=w.grass[prey.y*w.P.W+prey.x];
  return g>=S ? 0.10 : 1 - 0.9*(g/Math.max(S,1e-9));
}
/* the same exposure, evaluated for ME if I stood at (px,py) - what fear
   and hiding decisions are made of */
function exposureAt(w,a,px,py){
  const S=a.legs+a.body+a.mouth+a.fat;
  const g=w.grass[py*w.P.W+px];
  return g>=S ? 0.10 : 1 - 0.9*(g/Math.max(S,1e-9));
}

/* Hunger runs 0 (comfortable) to 1 (about to starve), judged against a
   horizon of comfortSteps of body metabolism. */
function hunger(w,a){
  const comfort = w.P.starveBelow + w.P.comfortSteps*w.P.bodyCostPer*Math.max(1,a.body);
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
  return w.P.starveBelow + w.P.reproReserveSteps*w.P.bodyCostPer*Math.max(1,a.body);
}
function reproThreshold(w,a){
  return Math.max(a.legs+a.body+a.mouth, litterShare(w,a)+reserveFloor(w,a));
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
  const P=w.P, see=perceive(w,a,idx), h=hunger(w,a), r=reproReady(w,a);
  /* Appetite serves two masters. Survival hunger h (0..1) prices a meal at
     full weight. Breeding appetite keeps an animal eating past comfort
     until fat clears ~130% of its reproduction threshold - satiety pinned
     to the SURVIVAL horizon alone froze the whole world at fat ~9 with
     zero births in every seed (measured). The 0.6 weight keeps ambition
     gentler than starvation, so fear can override one but barely dents
     the other. */
  const target=reproThreshold(w,a)*1.3;
  const drive=Math.max(h, 0.6*Math.max(0, 1-a.fat/target));

  /* candidate destinations: stay, plus legs-radius points on 16 bearings
     at full and half stride. Integer cells, deduplicated. */
  const cands=[{x:a.x,y:a.y,d:0}];
  if(a.legs>0){
    for(let k=0;k<16;k++){
      const th=k*Math.PI/8;
      for(const frac of [1,0.5]){
        const dr=a.legs*frac; if(dr<1) continue;
        const nx=Math.round(a.x+Math.cos(th)*dr), ny=Math.round(a.y+Math.sin(th)*dr);
        if(nx<0||ny<0||nx>=P.W||ny>=P.H) continue;
        const dd=dist(a.x,a.y,nx,ny);
        if(dd<=a.legs+1e-9 && !cands.some(c=>c.x===nx&&c.y===ny)) cands.push({x:nx,y:ny,d:dd});
      }
    }
  }

  /* immediate actions on the current cell */
  let best={ kind:'stay', score:-1e9 };
  if(!a.carn){
    const g=w.grass[a.y*P.W+a.x];
    const gain=Math.min(a.body,g);
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
      const s=drive*catchProb(w,tgt.b)*preyValue(tgt.b) - fearAt(w,a,a.x,a.y,see.predators,h);
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
    else       { for(const p of see.prey)      v=Math.max(v,drive*catchProb(w,p.b)*preyValue(p.b)/(1+dist(c.x,c.y,p.x,p.y))); }
    let mv=0;
    if(r>0) for(const m of see.kin) mv=Math.max(mv, P.mateWeight*r/(1+dist(c.x,c.y,m.x,m.y)));
    const s = v + mv - fearAt(w,a,c.x,c.y,see.predators,h) - P.moveCostPer*c.d;
    if(s>best.score) best={kind:'move', score:s, to:c};
  }

  /* An animal whose needs cannot be answered by anything in sight WANDERS
     instead of standing still: hungry with no grass in view, or ready to
     breed with no kin in view. Without this, an isolated animal is a
     statue, and reunion of a scattered species is impossible. */
  if(best.score<=1e-6 && a.legs>0 && cands.length>1 &&
     ( (drive>0.2 && (a.carn? !see.prey.length : !see.grassSpots.length)) ||
       (r>0 && !see.kin.length) )){
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
      a.fat+=preyValue(best.target);
      /* the diet ledger: what does each carnivore species actually eat */
      const pk=key(a), qk=key(best.target);
      let m=w.preyLog.get(pk); if(!m){ m=new Map(); w.preyLog.set(pk,m); }
      m.set(qk,(m.get(qk)||0)+1);
    }
  } else if(best.kind==='mate'){
    mate(w, a, best.partner, idx);
  } else if(best.kind==='move' && best.to.d>0){
    a.x=best.to.x; a.y=best.to.y; a.moved=best.to.d;
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
    mom.fat-=perParent; dad.fat-=perParent;
    const baby={ id:w.nextId++, x:mom.x, y:mom.y,
      legs:mom.legs, body:mom.body, mouth:mom.mouth, eyes:mom.eyes,
      fat:P.babyFat, carn:(w.rnd()<0.5?mom:dad).carn, age:0, moved:0,
      founder:mom.founder };
    if(w.rnd()<P.mutationP){
      w.mutants++;
      const pick=Math.floor(w.rnd()*5);
      if(pick===4){ baby.carn=!baby.carn; if(baby.carn) w.carnFlips++; }
      else{
        const t=['legs','body','mouth','eyes'][pick];
        baby[t]=Math.max(0,Math.min(10,baby[t]+(w.rnd()<0.5?-1:1)));
      }
      const ck=key(baby);
      if(ck!==key(mom)){
        w.emergences.push({step:w.step, child:ck, parent:key(mom)});
        if(w.emergences.length>5000) w.emergences.shift();
      }
    }
    madeQueue.push(baby); made++; w.births++; if(baby.carn) w.carnBorn++;
    if(made>=6) break;   // engine guard: one pair, one step, six births max
  }
}
let madeQueue=[];

/* ---- one world step ------------------------------------------------------ */
function step(w){
  const P=w.P;
  /* grass first: a bare cell builds toward its first unit (1/regrowEvery
     per step - at regrowEvery 1 that is the spec's "1 unit grows"), and an
     established cell compounds 10% to the cap */
  const sprout=1/P.regrowEvery;
  for(let i=0;i<w.grass.length;i++){
    const g=w.grass[i];
    w.grass[i] = g<1 ? Math.min(1,g+sprout) : Math.min(P.grassMax, g*1.10);
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
    a.fat -= P.moveCostPer*a.moved + P.bodyCostPer*a.body;
    a.age++;
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
           carnFlips:w.carnFlips, carnBorn:w.carnBorn, carnStarved:w.carnStarved,
           carnMeanAge: w.carnStarved? +(w.carnAgeSum/w.carnStarved).toFixed(1):0,
           fatMean: w.animals.length? +(fat/w.animals.length).toFixed(2) : 0,
           list,
           topSpecies: [...sp.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5) };
}

global.Eco = { newWorld, step, stats, DEFAULTS, key };
})(typeof window!=='undefined' ? window : globalThis);
