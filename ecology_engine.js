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
   - CARCASS RECOVERY (2026-09-01, replacing the old conversion efficiency):
     a kill yields a FRACTION OF WHAT EACH PREY TISSUE COST TO BUILD -
     3.23/legs, 2.925/body, 0.105/mouth, 0.012/eyes, 0.92/fat - the fraction
     being accessibility x digestibility from the carcass-utilisation
     literature. Nothing about the PREDATOR's own build enters: the old
     0.9 - 0.04 x (eyes+legs) discount had no support anywhere and its floor
     sat below any measured recovery. Energy balance is structural: a
     predator can never get more out of a body than went into it.

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
     legs+body at the shipped weights (sizeEyes 0, sizeMouth 0) - can evict
     a smaller one and take its place; the loser is pushed to the nearest
     cell with room. NOTE (audit 2026-09-01): size enters ONLY as a filter
     on which cells are offered as movement candidates - there is no
     dominance term in any score, so an animal never prefers a cell because
     it could take it. Territory is an outcome here, not a behaviour.
     Eviction needs STRICTLY greater size, so trait-identical animals
     cannot displace each other, which lets a mated pair hold a good pixel
     against each other while still yielding to anything larger. This is
     the first benefit size has ever had in the model.

     WHAT COUNTS AS SIZE: legs + body, with eyes and mouth at weights
     sizeEyes and sizeMouth, both 0 since 2026-08-29. Joe, 2026-08-28: mouth
     left the contest because it was the cheapest way to be big - it cost
     nothing in basal metabolism, so selection bought territory with mouth
     and left body pinned at 1. THAT REASON EXPIRED 2026-09-01: mouth now
     costs 0.3/step to run and 0.7/unit to build. Build cost tracks tissue
     mass, and on that basis the mass-implied weights are legs 1.0 : body
     1.18 : mouth 0.18 : eyes 0.02 - so legs+body is already a fair mass
     proxy and the only real gap is mouth at ~0.18 instead of 0. Whether to
     restore it is an open decision; sizeMouth is the knob. */
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
  moveCostPer: 0.02,      /* fat per unit distance, now scaled by the animal's
     own basal (see the burn term). Was 0.1, which put a mid forager at 14.7%
     of its burn on locomotion and a full-legs mover at 25%; field budgets give
     1-3% for a small forager, 10-15% for a wide-ranging carnivore and under
     19% as a hard ceiling. At 0.02 the mid forager sits at 3.3%. */
  bodyCostPer: 0.1,       // fat per unit of basal tissue per step
  eyeCost: 1.0,           // how much one unit of eye counts toward basal
                          // upkeep, relative to a unit of leg or body.
                          // Joe, 2026-08-28: sensory tissue was the one
                          // free component, and once territory contests
                          // scored on L+B+M+E, selection inflated eyes to
                          // win pixels at no cost (measured: E 1 -> 3.6).
                          // Real retinas are expensive; so are these.
  starveBelow: 1,
  /* STOCHASTIC MORTALITY (Joe, 2026-08-28). Nothing in the model aged an
     animal out: a fed animal could only die of starvation or a predator, so
     a well-fed founder survived whole runs and - worse - any animal whose
     intake exactly cancelled its upkeep became immortal, permanently hungry
     and permanently sterile (the metabolic-stasis attractor). A flat hazard
     gives every animal a finite expected life of 1/mortality steps
     regardless of how comfortable it is. 0.002 = a mean life of 500 steps. */
  mortality: 0.002,
  /* A newborn used to receive a flat babyFat=2 whatever its body plan. For
     anything above L3/B3/E3 that was less than ONE step of its own upkeep,
     so large offspring were born already dead - an unintended selection
     gradient against big bodies (audit, 2026-08-28). The endowment is now
     the LARGER of babyFat, a survival floor, and its strategy's allowance
     metabolism, and the parents are charged for what they actually give. */
  /* ---- r/K PROVISIONING (Joe, 2026-08-29) --------------------------------
     A fifth species-identifying trait, binary: 'f' spends little on each
     newborn, 'F' spends a lot. It replaces the single babyUpkeepSteps dial
     with a strategy the population can evolve, and it is BINARY on purpose -
     a 1..10 version would multiply genotype space tenfold and strand every
     mutant reproductively, worsening the Allee bottleneck it is meant to
     relieve, and would only be bimodal if bimodality happened to emerge.
     Kept inside species identity (unlike, say, eyes and allometry) because
     the cost and the benefit must stay in the same animal: with mixed pairs
     the endowment would follow one parent while both paid, so the expense of
     F would be socialised across partners while the benefit was inherited
     privately - the same shape of bug that let eyes ride on sizeEyes. */
  /* ---- DISTURBANCE (Joe, 2026-08-29) -------------------------------------
     A patch of the world is hit: some of its animals die and some of its
     standing crop is destroyed. The REGIME is a property of a world (drawn
     once per run), while each EVENT draws its own size from that regime - so
     a world has a character, "frequent small fires" or "rare catastrophic
     resets", which is the thing worth correlating outcomes against.

     ANIMAL KILL AND GRASS REMOVAL ARE SEPARATE AXES, deliberately. They pull
     f and F in OPPOSITE directions: clearing animals but leaving the grass
     opens ground with food already standing, which rewards whoever colonises
     fastest (cheap offspring, f); clearing the grass as well forces colonists
     to survive the regrowth gap on their endowment (F). One combined
     magnitude can only ever push one way at a time, so a single world could
     not contain both forces - and both is what a maintained polymorphism
     needs. Set disturbCoupled true to tie them together and get the
     single-axis behaviour back for comparison.

     Two things are deliberately NOT disturbed. The quality field (the soil)
     survives, so recolonisation follows the landscape's existing structure
     rather than starting blank. And the kill is uniformly at random rather
     than size-selective: density-independent mortality is the classic
     condition favouring r-strategists, and biasing it by body size would
     confound the very mechanism this is here to create. */
  /* WALLS (Joe, 2026-08-29). Impassable ridges scattered across the map, to
     break the global synchrony that lets one herbivore wave sweep the whole
     world and leave it bare - measured at a ~150-step cycle with 75-fold
     amplitude. Subdividing space decouples local booms and busts so they
     average out instead of adding up.

     Implemented as BLOCKED CELLS rather than walls between cells, because
     that is far cheaper: a blocked cell is one array read in the movement
     loop, whereas an edge between cells would need the path of every
     multi-cell move traced and tested against every edge it crosses - on the
     hottest loop in the engine. Drawn as thin lines rather than blobs, so
     they cost almost no habitat: a one-cell ridge across a 160-wide map is
     about 1% of the ground.

     GAPS MATTER. Sealed compartments do not stabilise a world, they fragment
     it - isolated pockets go extinct with no way to be recolonised. Every
     wall therefore carries openings. */
  wallCount: 0,           // 0 = no walls
  wallGaps: 2,            // openings per wall, so nothing is ever sealed off
  wallSpan: 0.75,         // fraction of the map's width or height a wall crosses

  disturbEvery: 0,        // 0 = never. Expected steps between events
  /* SIZE IS A DIAMETER, in cells - what you would measure across the scar on
     the map. It was a radius until 2026-08-29, which made "10 to 100" mean
     patches up to 200 cells across on a 160x90 world, i.e. larger than the
     world (Joe caught this). Drawn LOG-uniformly, so most events are small
     and a few are very large. */
  disturbDiamLo: 6,
  disturbDiamHi: 60,
  disturbKill: 0.6,       // fraction of animals inside the patch that die
  disturbGrass: 0.6,      // fraction of the standing crop removed
  disturbCoupled: false,  // true = grass removal follows the kill fraction

  provLowSteps: 4,        // 'f' - steps of its own upkeep a cheap newborn gets
  provHighSteps: 10,      // 'F' - and a well-provisioned one
  /* 4 and 10 chosen by sweep (3 seeds x 3000 steps, F's share of the whole
     population): 2/10 -> 95% F, 3/10 -> 78%, 4/10 -> 51%, 5/10 -> 24%,
     4/8 -> 9%. Below 4 the cheap strategy sits barely above the survival
     floor and is not an alternative but a death sentence, so F sweeps. At
     4/10 both persist in BOTH guilds (herbivores 1558 f / 1621 F, carnivores
     14 f / 19 F). Read that honestly though: the balance tips hard between
     4 and 5, so this is a tuned fitness TIE, not frequency-dependent
     coexistence - nothing yet makes the rare strategy advantageous. A
     disturbance regime is what would make it robust, by letting f win the
     recolonisation race while F holds the crowded interior. */
  /* 3 -> 7 (Joe, 2026-08-29), for uniformity as much as for survival. At 3 the
     babyFat floor of 2 propped up small newborns to 5-6.7 steps of their own
     upkeep while anything with basal above ~7 got exactly 3 - so provisioning
     was quietly biased AGAINST large-bodied and carnivorous offspring, which
     is the class that kept failing. A diet-flip carnivore was born with three
     steps of fuel and needs two of them just to reach prey (hunting only
     fires from the prey's own cell), so most died mid-approach having never
     attacked - measured: median life 1 step, and 69 steps when given more fat,
     while raising the catch chance from 0.10 to 0.81 changed nothing.
     At 7 the scaled term clears the floor for every body plan, so every
     newborn gets the same seven steps whatever it is. Parents pay for it:
     perParent is (build + endow)/2, so the breeding threshold rises with it
     and the mass balance still closes. */
  /* GAPE RULE (Joe, 2026-08-29). Predation needs the hunter's mouth to admit
     the prey's body. With the strict form (mouth > body) and both traits
     capped at 10, a body-10 herbivore is uneatable by ANY animal the model
     can build - an absolute refuge handed over by the trait ceiling, not
     earned. Five of ten 500k-step runs escaped into it and ran every trait
     to the ceiling. gapeStrict:false relaxes the test to mouth >= body, so
     the largest predator can still take the largest prey.

     SWITCHED TO >= ON 2026-09-01, measured. Carnivores are diet-flip mutants
     of the herbivores, so a fresh carnivore carries its ancestor's mouth. In
     the failing A/B seed the dominant herbivore went L4.B5.M6 -> L4.B6.M6 at
     t~20,000: carnivores fell 174 -> 3 and stayed there for 80,000 steps,
     while explain-mode showed every carnivore seeing ZERO gape-eligible prey
     among 3,000-4,000 fully exposed herbivores. Across 48 runs, 13 had a
     dominant with mouth <= body and carried a median 5 carnivores against 47
     elsewhere; at mouth == body exactly, 0.3% of the prey base was edible
     under > and 100% under >=. The original reason for the strict form -
     newborn cannibalism - is handled by intraguildGap (catchProb is exactly 0
     between equal-sized carnivores): measured 0.12% carnivore-on-carnivore
     kills under >= versus 0.16% under >. */
  gapeStrict: false,
  /* PER-SPECIES VITAL RATES (Joe, 2026-08-29). The wall shows a birth rate R
     and the share of deaths owed to starvation / background / predation for
     each common species. Cumulative totals would be dominated by ancient
     history, so events are counted into a rolling window: vitalCur fills for
     vitalWindow steps, is then frozen as vitalPrev and reported, and a fresh
     window starts. Counting is event-driven (a birth, a death) so it costs
     nothing on the hot path. */
  vitalWindow: 250,

  /* ---- THREE DESIGN SWITCHES, all default-OFF so the shipped model is
     unchanged until an A/B says otherwise (2026-08-29). ---------------- */

  /* sizeEyes: how much an eye counts toward winning a territorial contest.
     1 is the historical behaviour. The audit measured that the FORAGING
     value of eyes saturates at radius 2 (fat gained by eyes 0/1/2/3/5/10 =
     491/2869/3316/3382/3336/3364), yet eyes still evolve to 10 - because
     sizeOf counts them, so they buy ground. Eyes are the least plausible
     thing to win a shoving match with; at 0 they must pay for themselves
     through perception alone. */
  sizeEyes: 0,        // SHIPPED 2026-08-29 - see the A/B note below

  /* cellMass: a cell's carrying capacity measured in BODY MASS rather than
     headcount. 0 keeps the headcount rule (cellCap animals per guild). Set
     above 0 and a cell instead holds animals until their combined sizeOf
     would exceed this, always admitting at least one - so two small animals
     share a pixel where one giant fills it alone. This makes large size cost
     TERRITORY, which is the real ecological brake on body size and is what
     the headcount rule removes: today an L10 giant occupies exactly as much
     ground as an L1 minimal. 8 matches the old capacity for small animals
     (an L2 B1 E1 grazer is sizeOf 4, so two still fit). */
  cellMass: 0,

  /* allometrySpan: the largest gap allowed between the biggest and smallest
     of legs, body and mouth (Joe, 2026-08-29 - "this predator with a huge
     mouth and tiny everything seems biologically implausible"). 0 disables
     it. At 2, L1 B1 M6 is illegal and a big mouth has to be carried by a
     body and legs within two units of it. Eyes are deliberately exempt:
     being blind or sharp-eyed is independent of build. Enforced on mutation
     and on random founders, so no illegal animal ever exists. */
  allometrySpan: 2,   // SHIPPED 2026-08-29 - see the A/B note below

  /* huntCost: what a FAILED hunt costs the attacker, per unit of the prey's
     defensive mass (legs + body). 0 is the historical free-attack model.
     Joe's rationale (2026-08-29): "predator vs predator contests should be
     rarer because the two can inflict damage on each other" - and more
     generally, an attack that costs nothing makes every animal under your
     gape worth trying, which collapses the food web into "eat anything
     smaller". With a cost, expected value is
         catchProb x efficiency x meal  -  (1 - catchProb) x huntCost x (L+B)
     so each predator acquires an OPTIMAL PREY SIZE - big enough to be worth
     the meal, small enough to be safe - which is the trade-off that lets
     hunters specialise instead of all converging on one strategy.
     Default 0 pending its own A/B; adjustable on the lab's setup sheet. */
  huntCost: 0,

  /* INTRAGUILD SIZE GAP (Joe, 2026-08-29). A carnivore may only take ANOTHER
     CARNIVORE if it is substantially bigger, measured on legs + body + mouth:
     no advantage at all when they are the same size, rising to a free hand at
     intraguildGap units apart. Predation on HERBIVORES is untouched.

     The point is that it forbids cannibalism as a CONSEQUENCE rather than by
     decree - two animals of one species are identical in size, so the term is
     exactly zero and a species can never eat itself. It also opens room for
     more than one carnivore trophic level: a big enough hunter can take
     smaller hunters, but only as a minor part of its diet or when they are
     unusually abundant, which is how intraguild predation actually works.

     Measured motivation: the resident predator was losing 25-30% of its
     deaths to being eaten, at roughly twice the background rate, because at
     L1 B1 M3 its mouth cleared its own body.

     Combined with concealment by MIN, not by product (Joe's call): a hunter
     must be both big enough AND catch its target in the open, rather than the
     two effects diluting one another. 0 disables the rule. */
  /* How much an EYE costs a predator in conversion efficiency, separately
     from how much a LEG costs. They were welded together at 0.04 each in
     convEff = 0.9 - 0.04(eyes + legs), which taxes detection at the same rate
     as pursuit - so the animal whose whole livelihood is finding prey pays
     extra for finding it, on top of the upkeep and breeding-threshold cost
     every animal pays for eyes. Setting this to 0 keeps the ambush-versus-
     courser axis on LEGS, where the locomotor cost actually lives, and stops
     charging for sight. */
  /* How far a predator can STRIKE, in cells. 0 is the historical rule: it
     can only take prey standing on its own square, so every attempt costs at
     least two turns - one to arrive, one to attack - with the prey free to
     leave in between. Measured consequence: 62-88% of a carnivore's turns
     are approaches and only 11-38% are attacks. At 1 it can also take prey
     on the eight neighbouring squares without moving.
     Deliberately NOT routed through perceive(), which is limited by eyes:
     the dominant predators evolve to eyes 0, and a blind animal can still
     strike what it is touching - the same reasoning as touchMates. */
  /* REVERTED to 0 (Joe, 2026-08-29). At reach 1 the full 10,000-step
     factorial showed prey answering it by getting BIG: herbivore body 3.28 ->
     5.87 alone and 6.87 combined with convEyes 0, escaping into the gape
     refuge. The guild ended up SMALLER than with convEyes 0 alone (44 and 26
     against 85). The mechanism worked; the evolutionary answer to it undid
     the benefit. Kept as a parameter. */
  huntReach: 0,

  convEyes: 0,         // SHIPPED 2026-08-29 - sight is no longer taxed
  /* 2x2 at 6,500 steps, 3 seeds, moderate world (grassMax 50, growth 2-18%).
     The two changes work through DIFFERENT mechanisms:
         arm            carnivores   kills/1000   carnivore eyes
         control             35         3031          3.40
         convEyes 0         102         2814          5.00
         huntReach 1         35         5542          3.00
     Dropping the conversion penalty nearly TRIPLES the guild and makes eyes
     worth buying (3.40 -> 5.00) without raising the kill rate: more predators
     each killing less. The strike reach leaves the guild the same size and
     makes each one 83% more lethal. Provisional - n=3, and the run had not
     finished when these were adopted. */
  convLegs: 0.04,

  intraguildGap: 3,   // SHIPPED 2026-08-29 after the A/B below

  /* A/B at 10,000 steps, 6 paired seeds, gap 0 vs 3 vs 5. The rule does what
     it was built for and nothing more:
         gap        0       3       5
         carnivore P (eaten)   22.5%   0.5%   0.0%     <- cannibalism gone
         carnivore count        45     68.5    70      <- guild +55%
         kills / 1000 steps   3202    5018    4788     <- predation +57%
         HERBIVORE P            5.0%   5.0%   5.0%     <- unchanged
         carnivore size classes 3.0    3.0     2.5     <- no second level
     3 over 5 for the slightly wider carnivore size spread (0.65 vs 0.40) and
     the higher kill rate. Note what did NOT happen: a guild half again as
     large, killing half again as much, moved the herbivores' predation share
     not at all - the extra kills were absorbed by a larger, fatter prey
     population. And carnivores all grew TOGETHER (mean size 9.55 -> 11.4)
     rather than splitting into classes, because the advantage the rule gives
     is purely relative: everyone climbs and the gap stays near zero. It is a
     Red Queen race, not diversifying selection. */

  /* ---- WHAT THE A/B ACTUALLY MEASURED (6 arms x 6 paired seeds x 20,000
     steps, 160x90, regrowEvery 4). Medians at step 20,000:

       arm          bodySlope   pop   species  carnivores  illegal builds
       baseline      -0.028    3938     23         38          32%
       noEyeSize     -0.020    3970     23         35          93%
       allometry     +0.093    4026     27         27           0%
       allom_noEye   -0.018    5206     20        232           0%

     The pair we shipped (allometrySpan 2 + sizeEyes 0) wins on carnivore
     persistence by SIX TIMES (232 against 38), carries a third more animals,
     and makes an allometrically absurd body plan impossible by construction.
     It costs a little diversity (20 species against 23).

     ALLOMETRY ALONE IS WORSE THAN DOING NOTHING: body climbed in 4 of 6
     seeds against 2 of 6 for baseline. Constraining legs/body/mouth without
     also removing eyes from the territory contest just moves the pressure
     into eyes (4.49, the highest of any arm). The two changes are only
     useful together - do not ship one without the other.

     Honest limits: median body slope is NOT better than baseline (-0.018 vs
     -0.028), and one seed of six (66606) still ran away to L8.99 B7.01 M8.99.
     This suppresses the runaway in most worlds; it does not abolish it. ---- */
  /* Lowered from 2 (2026-08-29). At 2 the floor dominated every small body
     plan, so f and F newborns received identical fat and the strategy was
     selectively invisible in exactly the small-bodied majority. What now
     guarantees a newborn survives its own birth step is the SURVIVAL floor
     in babyEndow - starveBelow plus one step of upkeep - which scales with
     the animal instead of being a constant. */
  babyFat: 0.5,             // DECISION: newborn's starting fat
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
  /* ---- MAMMAL ENERGY ECONOMICS (Joe, 2026-09-01) -----------------------
     Three coefficient sets, derived separately and deliberately kept apart,
     because they answer different physiological questions:
       BUILD      one-time biosynthetic cost, paid out of parental fat.
                  Tracks tissue MASS. Per gram, tissues cost almost the same to
                  build (muscle 0.135, gut 0.151, bone 0.162 fat-units/g) - lean
                  tissue is 75-80% water and water is free. What differentiates
                  the traits is how much tissue a trait unit buys: legs 35% of
                  lean mass, body 35%, mouth 6% (the gut is a SMALL organ),
                  eyes 0.3%.
       BASAL      per-step running cost. Tracks mass x metabolic RATE, which is
                  a different ordering: the gut is 6% of the mass but 15% of
                  resting metabolism. Non-primate mammal budget (Mink 1981,
                  n=28): muscle 22% of RMR, GI 15%, CNS 5%, rest of soma 58%.
       RECOVERY   what a predator gets back, as e_t * c_t. e_t is pure
                  accessibility x digestibility, in [0,1], so recovery can never
                  exceed what went in. THAT IS THE POINT - mass/energy balance
                  is structural, not tuned.
     All linear: across the 1..10 trait range the 3/4 exponent buys a 1.78x
     spread and costs a great deal of clarity, so it is not worth it here.
     Set legacyEcon true to restore every pre-2026-09-01 form exactly. */
  legacyEcon: false,
  buildLegs: 3.8, buildBody: 4.5, buildMouth: 0.7, buildEyes: 0.07,
  basalLegs: 0.75, basalBody: 1.8, basalMouth: 0.3, basalEyes: 0.15,
  /* recovery = e_t * c_t, folded to one number per trait so the hot path does
     no extra multiplies. e = 0.85 legs / 0.65 body / 0.15 mouth / 0.17 eyes /
     0.92 fat. Mouth is low because GUT CONTENTS are ~68% of the bundle and are
     worth exactly zero to a carnivore - wolves refuse rumen contents across
     31,276 scat and stomach samples, pumas bury the rumen whole. */
  recLegs: 3.23, recBody: 2.925, recMouth: 0.105, recEyes: 0.012, recFat: 0.92,
  basalRef: 15,        // the 5/5/5/5 animal; movement is charged relative to it
  sdaFrac: 0.10,       // specific dynamic action: the cost of processing a meal
  /* HERBIVORE EFFICIENCY IS 1 AND MUST STAY 1 (Joe, 2026-09-01). Grass here is
     not biomass with a composition, it IS the energy resource, so assimilation
     loss is already inside the units. Charging it again double-counts. This
     looks like an oversight otherwise, hence the note. */
  reproReserveSteps: 25,  /* steps of body metabolism kept back before breeding.
     Was 15. Raised because SELECTION RAISED IT: with the coefficient made
     heritable it climbed +5-8% over 100,000 steps in every productive open
     world, monotonically, at 24-35x the drift yardstick - and was still
     climbing when the runs ended, so 16.2 was a floor and not an equilibrium.
     Joe set 25. Caveat for whoever reads this next: it did NOT rise in lean
     fragmented worlds, and it was selected under the OLD build cost, which was
     ~2.7x cheaper - so the gradient it climbed has changed shape. */
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
/* Pull a drawn build into the allometric window. RAISES the smallest trait
   rather than cutting the largest, because a hunter's mouth is drawn to clear
   its neighbour grazer's body and shrinking it would strand the predator with
   jaws too small for the only prey in reach. Bounded, so it always terminates
   - a re-roll loop could not, since a mouth of 10 can never be matched by a
   legs/body drawn from 1..6. */
function legalise(P, sp){
  if(!P.allometrySpan) return sp;
  for(let g=0; g<24; g++){
    const hi=Math.max(sp.legs,sp.body,sp.mouth), lo=Math.min(sp.legs,sp.body,sp.mouth);
    if(hi-lo<=P.allometrySpan) break;
    if(sp.legs===lo && sp.legs<10) sp.legs++;
    else if(sp.body===lo && sp.body<10) sp.body++;
    else if(sp.mouth===lo && sp.mouth<10) sp.mouth++;
    else break;                                  // already at the ceiling
  }
  return sp;
}
function randomFounders(rnd, P){
  const out=[], seen=new Set();
  const draw=()=>1+Math.floor(rnd()*6);
  const cnt=(lo,hi)=>lo+Math.floor(rnd()*(hi-lo+1));
  for(let c=0;c<4;c++){
    let herb;
    do { herb={ name:'grazer'+(c+1), legs:draw(), body:draw(),
                mouth:draw(), eyes:draw(), bigF:rnd()<0.5, carn:false,
                count:cnt(P.herbCountLo, P.herbCountHi) };
      legalise(P, herb);
    } while(seen.has(key(herb)));
    seen.add(key(herb));
    let carn;
    do { carn={ name:'hunter'+(c+1), legs:draw(), body:draw(),
                mouth:Math.min(10, herb.body+1+Math.floor(rnd()*4)),
                eyes:draw(), bigF:rnd()<0.5, carn:true,
                count:cnt(P.carnCountLo, P.carnCountHi) };
      legalise(P, carn);
    } while(seen.has(key(carn)));
    seen.add(key(carn));
    out.push(herb, carn);
  }
  return out;
}

/* SPECIES KEY, e.g. "L6.B6.M4.E1.f.H" (2026-08-29). Dots rather than commas:
   the old comma form shredded every CSV it was written into, and dots read
   like an address at a glance. Order is the four morphological traits, the
   provisioning strategy, then the diet. */
/* Lay out the walls: each is a straight ridge, horizontal or vertical, at a
   random offset, spanning wallSpan of the map, with wallGaps openings punched
   through it. Returns a Uint8Array flag per cell. */
function buildWalls(P, rnd){
  const N=P.W*P.H, blocked=new Uint8Array(N);
  for(let k=0;k<(P.wallCount|0);k++){
    const vert = rnd()<0.5;
    const len  = Math.round((vert?P.H:P.W)*P.wallSpan);
    const start= Math.floor(rnd()*((vert?P.H:P.W)-len+1));
    const at   = Math.floor(rnd()*(vert?P.W:P.H));
    /* punch the gaps first so they can be checked cheaply while drawing */
    const gaps=[];
    for(let g=0; g<(P.wallGaps|0); g++){
      const c=start+Math.floor(rnd()*len);
      gaps.push([c-1, c+1]);            // three cells wide, enough to walk through
    }
    for(let i=start;i<start+len;i++){
      let open=false;
      for(const gp of gaps) if(i>=gp[0] && i<=gp[1]){ open=true; break; }
      if(open) continue;
      const x = vert? at : i, y = vert? i : at;
      if(x<0||y<0||x>=P.W||y>=P.H) continue;
      blocked[y*P.W+x]=1;
    }
  }
  return blocked;
}

function key(a){
  return 'L'+a.legs+'.B'+a.body+'.M'+a.mouth+'.E'+a.eyes+
         '.'+(a.bigF?'F':'f')+'.'+(a.carn?'C':'H');
}
/* The inverse, exported so no page or script has to know the format. */
function parseKey(k){
  const p=String(k).split('.');
  return { legs:+p[0].slice(1), body:+p[1].slice(1),
           mouth:+p[2].slice(1), eyes:+p[3].slice(1),
           bigF:p[4]==='F', carn:p[5]==='C' };
}

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
  const blocked = P.wallCount ? buildWalls(P, rnd) : null;
  const grass = new Float32Array(P.W*P.H).fill(P.grassInit);
  if(blocked) for(let i=0;i<grass.length;i++) if(blocked[i]) grass[i]=0;
  const quality = buildQuality(P, rnd);
  const w = { P, rnd, grass, quality, animals:[], step:0, nextId:1,
              births:0, starved:0, eaten:0, mutants:0,
              carnFlips:0, carnBorn:0, carnStarved:0, carnAgeSum:0, evictions:0,
              diedOfAge:0, aliveCount:0, huntsFailed:0, blocked:blocked,
              disturbances:0, disturbKilled:0, lastDisturb:null,
              vitalCur:new Map(), vitalPrev:new Map(), vitalSteps:0,
              /* MASS BALANCE (Joe, 2026-08-28). Every mutation of an
                 animal's fat is booked here so the identity
                   dFat = grazed + predGain - burned - buildLost
                          - starvedFat - preyFatLost
                 can be checked exactly. Grass is the ONLY external input:
                 grazed is drawn from the grass array, everything else is a
                 transfer between animals or a sink. If the identity closes,
                 "predation creates fat" is the intended conversion of
                 structural tissue into store, not a computational leak. */
              ledger:{ grassBurned:0,
           grazed:0, predGain:0, preyFatLost:0, burned:0,
                       buildLost:0, babyGot:0, starvedFat:0, grassGrown:0 },
              explain:false,       // when true, every decision is recorded
              whys:[],             // this step's decision records
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
  /* An explicit list is honoured even when EMPTY - that is how the
     microscope asks for a bare world it will populate by hand. Only null
     or undefined means "draw me some". */
  /* Founders supplied by hand (the lab's setup sheet, a batch script) are
     legalised too, not just the ones drawn here - otherwise a run could start
     with animals its own mutation rule forbids, and the settings card would
     advertise builds that the engine would never let breed. legalise() edits
     in place, so w.founders and the card agree with what actually exists. */
  w.founders = P.founders ? P.founders.map(sp=>legalise(P, Object.assign({}, sp)))
                          : randomFounders(rnd, P);
  /* Founders scatter within an 18x18 patch in a corner; with eight
     populations the corners take two apiece, so each hunter starts in the
     same country as a grazer it can actually eat. */
  /* Founder patches sized to the world: on a 10x10 study grid the old
     fixed 18-cell patch put corners at negative coordinates and indexed
     off the end of the grass array. */
  const patch=Math.max(1, Math.min(18, Math.floor(Math.min(P.W,P.H)/2)));
  const corners=[[0,0],[P.W-patch,0],[0,P.H-patch],[P.W-patch,P.H-patch]];
  w.founders.forEach((sp,i)=>{
    const [cx,cy]=corners[i%4];
    const many = (sp.count!==undefined) ? sp.count
               : (sp.carn ? P.carnPerSpecies : P.herbPerSpecies);
    for(let k=0;k<many;k++){
      /* founders respect the cap too - retry a few times for an open cell */
      /* The old retry counted BOTH guilds against cellCap and, after 40
         misses, placed the founder on top of a full cell anyway (audit,
         2026-08-28). Count only the founder's own guild when capPerDiet is
         on, and widen the patch rather than overfill. */
      let px=0, py=0, placed=false;
      for(let tries=0; tries<200 && !placed; tries++){
        const grow = patch + Math.floor(tries/40);      // widen if crowded
        px=Math.max(0,Math.min(P.W-1, cx+Math.floor(rnd()*grow)));
        py=Math.max(0,Math.min(P.H-1, cy+Math.floor(rnd()*grow)));
        let n=0;
        for(const b of w.animals){
          if(b.x!==px||b.y!==py) continue;
          if(P.capPerDiet && b.carn!==!!sp.carn) continue;
          n++;
        }
        if(w.blocked && w.blocked[py*P.W+px]) continue;
        if(n<P.cellCap) placed=true;
      }
      if(!placed){ w.founderSkipped=(w.founderSkipped||0)+1; continue; }
      w.animals.push({ id:w.nextId++, x:px, y:py,
        legs:sp.legs, body:sp.body, mouth:sp.mouth, eyes:sp.eyes,
        bigF:!!sp.bigF,
        fat:P.initFat, carn:!!sp.carn, age:0, moved:0,
        founder:sp.name||('corner'+(i+1)) });
    }
  });
  w.aliveCount=w.animals.length;   // mate()'s population guard reads this
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

/* ---- (1 + distance) LOOKUP TABLE ----------------------------------------
   Profiling (2026-08-29) put the cost of a step in the movement-scoring
   loop, not in perception: for every candidate cell within `legs` the animal
   divides by (1 + distance) to every grass spot, prey, kin and predator it
   can see. At legs 10 that is ~440 candidates x ~10 targets = ~4,400 square
   roots per animal per step.

   Candidates lie within legs<=10 of the animal and targets within eyes<=10,
   so the separation is at most 20 on each axis and the whole table is 41x41
   doubles. It stores 1+d rather than 1/(1+d) DELIBERATELY: keeping the
   division in the caller makes the arithmetic bit-identical to the old
   dist() path, where multiplying by a stored reciprocal would not be.
   Float64Array, not Float32Array, for the same reason. */
const DR=20, DW=2*DR+1;
const DP1=new Float64Array(DW*DW);
for(let dy=-DR;dy<=DR;dy++) for(let dx=-DR;dx<=DR;dx++)
  DP1[(dy+DR)*DW+(dx+DR)] = 1+Math.sqrt(dx*dx+dy*dy);
/* 1 + dist(ax,ay,bx,by), from the table when in range and the long way when
   not (a caller outside +-20 would otherwise read the wrong cell) */
function dp1(ax,ay,bx,by){
  const dx=ax-bx, dy=ay-by;
  if(dx<-DR||dx>DR||dy<-DR||dy>DR) return 1+Math.sqrt(dx*dx+dy*dy);
  return DP1[(dy+DR)*DW+(dx+DR)];
}

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

/* MOVEMENT offsets: EVERY cell within legs distance, nearest first.
   Joe, 2026-08-28 - "L=x means all the squares inside radius x". The old
   generator sampled 16 bearings at full and half stride, which is a sparse
   RING, not a disc: measured coverage was 100% at legs 1-2 but 59% at legs
   3, 43% at legs 4 and 21% at legs 6, and for legs >= 3 it could not offer
   the adjacent cell directly ahead at all - a fast animal could overshoot a
   neighbour but never step onto it. That silently taxed legs (blocking fine
   positioning, reaching an adjacent mate, and targeting a neighbour for
   eviction) and is a plausible part of why legs kept collapsing to 1-2.
   Nearest-first ordering means cheap moves are considered before expensive
   ones, so ties resolve toward staying close. */
/* Scratch for the candidate list - sized for the largest legs radius the
   trait ceiling allows, and grown defensively if that ever changes. */
let CAND_X=new Int16Array(1024), CAND_Y=new Int16Array(1024),
    CAND_D=new Float64Array(1024);
const MOVE_OFFS=[];
for(let R=0;R<=10;R++){
  const list=[];
  for(let dy=-R;dy<=R;dy++) for(let dx=-R;dx<=R;dx++){
    if(dx===0 && dy===0) continue;
    const d=Math.sqrt(dx*dx+dy*dy);
    if(d<=R+1e-9) list.push({dx,dy,d});
  }
  list.sort((p,q)=>p.d-q.d);
  MOVE_OFFS.push(list);
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
      if(a.carn && (P.gapeStrict ? a.mouth>b.body : a.mouth>=b.body)) out.prey.push({b,x,y,d});
      if(b.carn && (P.gapeStrict ? b.mouth>a.body : b.mouth>=a.body)) out.predators.push({b,x,y,d});
      if(b.legs===a.legs && b.body===a.body && b.mouth===a.mouth && b.eyes===a.eyes
         && b.bigF===a.bigF && (!P.dietAssort || b.carn===a.carn)){
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
  out.prey.sort((p,q)=>(preyValue(q.b,P)/(1+q.d))-(preyValue(p.b,P)/(1+p.d)));
  out.prey.length=Math.min(out.prey.length,6);
  return out;
}
/* WHAT A CARCASS IS WORTH. Each term is e_t * c_t: the fraction of that tissue
   a predator physically reaches and digests, times what it cost to build. Fat
   is not privileged per unit - the model fixed one trait unit = one fat unit =
   one energy unit long ago, so the 5.7x adipose premium per GRAM is a
   conversion this model already performed by fiat. Re-importing it would be a
   units error; if a 5.x ever appears on prey.fat, that is what happened. */
function preyValue(b, P){
  if(!P || P.legacyEcon) return b.legs+b.body+b.fat;
  return P.recLegs*b.legs + P.recBody*b.body + P.recMouth*b.mouth
       + P.recEyes*b.eyes + P.recFat*b.fat;
}

/* BASAL RATE (Joe, 2026-08-28): upkeep is charged on legs + body, not body
   alone - locomotor tissue costs something to carry even when standing
   still. Floored at 1 so nothing is free to exist. Every "steps of
   metabolism" quantity (hunger horizon, breeding reserve) reads this same
   function, so they cannot drift apart from what is actually burned. */
function basal(a, P){
  if(!P || P.legacyEcon) return Math.max(1, a.legs+a.body+((P?P.eyeCost:1))*a.eyes);
  return Math.max(1, P.basalLegs*a.legs + P.basalBody*a.body
                   + P.basalMouth*a.mouth + P.basalEyes*a.eyes);
}
/* What the parents spend to make one offspring's BODY, over and above the fat
   they hand it. Tracks tissue mass, so legs and body dominate and the gut is
   cheap - the opposite ordering to basal, and correct: a gut is a small organ
   that runs hot. */
function buildCost(a, P){
  if(!P || P.legacyEcon) return a.legs+a.body+a.mouth;
  return P.buildLegs*a.legs + P.buildBody*a.body
       + P.buildMouth*a.mouth + P.buildEyes*a.eyes;
}

/* what territory contests are settled on: metabolically-paid tissue, plus
   mouth at whatever weight the world gives it (default 0) */
function sizeOf(a,P){
  return a.legs + a.body
       + (P ? P.sizeEyes : 1)*a.eyes
       + (P ? P.sizeMouth : 0)*a.mouth;
}
/* Is this build allowed? legs/body/mouth must lie within allometrySpan of one
   another; eyes are exempt. Always true when the rule is off. */
function allometric(P, legs, body, mouth){
  if(!P.allometrySpan) return true;
  const hi=Math.max(legs,body,mouth), lo=Math.min(legs,body,mouth);
  return (hi-lo)<=P.allometrySpan;
}

/* Can `a` occupy (x,y)? Returns null if not, otherwise the animal that must
   be evicted first (or undefined when there is simply room). The index is
   kept live through the step, so this sees moves already made this turn. */
/* ONE reused verdict object (2026-08-29). entryFor is called once per
   candidate cell per animal per step - ~440 times for a legs-10 animal - and
   used to allocate a fresh {evict} for every one of them, which dwarfed every
   other allocation in the engine. The result is consumed immediately by every
   caller and never held across another entryFor call (the candidate loop
   discards it; the execute path reads .evict before calling freeCellNear or
   relocate, neither of which touches entryFor), so a single shared object is
   safe. Capture .evict into a local if you ever need it to outlive the call. */
const ENTRY={ evict:null };
/* Does a cell have room for an animal of this guild and size? Under the
   headcount rule that is "fewer than cellCap live same-guild occupants";
   under the mass rule it is "their combined sizeOf plus mine fits the
   budget", with an empty cell always admitting one so a giant is never
   homeless. `excl` skips an occupant (the mover itself). */
function cellHasRoom(w, cell, carn, size, excl, k){
  const P=w.P;
  if(k!==undefined && w.blocked && w.blocked[k]) return false;   // rock
  if(!cell) return true;
  let n=0, m=0;
  for(const b of cell){
    if(b.dead || b===excl) continue;
    if(P.capPerDiet && b.carn!==carn) continue;
    n++; if(P.cellMass>0) m+=sizeOf(b,P);
  }
  if(P.cellMass>0) return n===0 || (m+size)<=P.cellMass;
  return n<P.cellCap;
}
function entryFor(w, idx, a, x, y){
  if(w.blocked && w.blocked[y*w.P.W+x]) return null;              // rock
  const cell=idx[y*w.P.W+x];
  if(!cell){ ENTRY.evict=null; return ENTRY; }
  /* Count only the LIVING (an animal eaten earlier this step has left a
     vacancy) and, when capPerDiet is on, only one's own trophic guild -
     grazers contest ground with grazers, hunters with hunters. */
  const perDiet=w.P.capPerDiet;
  let weakest=null;
  for(const b of cell){
    if(b===a){ ENTRY.evict=null; return ENTRY; }     // already standing here
    if(b.dead) continue;
    if(perDiet && b.carn!==a.carn) continue;
    if(!weakest || sizeOf(b,w.P)<sizeOf(weakest,w.P)) weakest=b;
  }
  if(cellHasRoom(w,cell,a.carn,sizeOf(a,w.P),a,y*w.P.W+x)){ ENTRY.evict=null; return ENTRY; }
  if(weakest && sizeOf(a,w.P)>sizeOf(weakest,w.P)){ ENTRY.evict=weakest; return ENTRY; }
  return null;
}

/* Move an animal between cells, keeping the live index correct. */
function relocate(w, idx, a, nx, ny){
  const from=idx[a.y*w.P.W+a.x];
  if(from){ const i=from.indexOf(a); if(i>=0) from.splice(i,1); }
  /* EVERY relocation is charged, including one an animal did not choose.
     Eviction used to set x/y directly and never touch a.moved, so 13% of
     all travel in the model was free - and it was the ONLY way a legs-0
     animal ever changed position, quietly bussing the sessile body plan
     around the map (audit, 2026-08-28). a.moved now accumulates and is
     zeroed by the metabolism loop after it has been paid for. */
  a.moved += Math.hypot(nx-a.x, ny-a.y);
  a.x=nx; a.y=ny;
  const k=ny*w.P.W+nx;
  if(idx[k]) idx[k].push(a); else idx[k]=[a];
}

/* Somewhere with room within `rad` of (x,y), nearest rings first - used for
   evicted animals and for newborns when the parents' cell is full. */
function freeCellNear(w, idx, x, y, rad, carn, size){
  size = size||0;
  /* EUCLIDEAN DISC, nearest first (fixed 2026-08-29). This walked square
     Chebyshev rings while movement uses a strict Euclidean disc, so a
     newborn could be seated on a cell its mother could never have stepped
     to - measured at 25.8% of all births on the default grid, and 65.6% of
     births from legs-1 mothers. MOVE_OFFS is exactly the right structure:
     every offset within the radius, already sorted nearest-first, and it
     excludes (0,0) because the caller has already tried home. */
  const R=Math.max(0, Math.min(MOVE_OFFS.length-1, rad|0));
  const offs=MOVE_OFFS[R];
  for(let i=0;i<offs.length;i++){
    const nx=x+offs[i].dx, ny=y+offs[i].dy;
    if(nx<0||ny<0||nx>=w.P.W||ny>=w.P.H) continue;
    const kk=ny*w.P.W+nx;
    /* a relocated animal - an evicted loser, or a newborn being placed - has
       to be able to GET there, not merely be near */
    if(cellHasRoom(w,idx[kk],carn,size,null,kk) && clearPath(w,x,y,nx,ny))
      return {x:nx,y:ny};
  }
  return null;
}
/* Book one vital event against a species in the open window. */
function vital(w, k, field){
  let v=w.vitalCur.get(k);
  if(!v){ v={births:0, starved:0, background:0, eaten:0}; w.vitalCur.set(k,v); }
  v[field]++;
}

/* Is the straight line from one cell to another clear of rock?

   Blocking a cell stops anything STANDING there, but on its own it does not
   stop anything CROSSING - and every way an animal changes position works by
   distance, not by path: a stride of two steps over a one-cell ridge, a
   newborn dispersing within its mother's leg reach, and above all eviction,
   which relocates the loser up to three cells away regardless of its legs.
   Measured before this existed: a SOLID wall with no gaps at all, animals
   with legs 1 - which cannot stride over anything - and 746 of them ended up
   on the far side, having never once stood on the rock itself.

   Costs nothing in a world without walls (the first line returns immediately)
   and at most `distance` array reads in one that has them. */
function clearPath(w, x0, y0, x1, y1){
  const blk=w.blocked;
  if(!blk) return true;
  const P=w.P, dx=x1-x0, dy=y1-y0;
  const n=Math.max(Math.abs(dx), Math.abs(dy));
  if(n===0) return true;
  for(let i=1;i<=n;i++){
    const x=Math.round(x0+dx*i/n), y=Math.round(y0+dy*i/n);
    if(blk[y*P.W+x]) return false;
  }
  return true;
}

/* Prey within striking distance: the predator's own square, plus the ring
   around it when huntReach allows. Gape is applied here, so the caller gets
   only animals it could actually swallow. */
function reachPrey(w, a, idx){
  const P=w.P, R=Math.max(0, P.huntReach|0), out=[];
  for(let dy=-R;dy<=R;dy++) for(let dx=-R;dx<=R;dx++){
    const d=Math.sqrt(dx*dx+dy*dy);
    if(d>R+1e-9) continue;
    const x=a.x+dx, y=a.y+dy;
    if(x<0||y<0||x>=P.W||y>=P.H) continue;
    const cell=idx[y*P.W+x]; if(!cell) continue;
    for(const b of cell){
      if(b===a||b.dead) continue;
      if(!(P.gapeStrict ? a.mouth>b.body : a.mouth>=b.body)) continue;
      out.push({b,x,y,d});
    }
  }
  return out;
}

/* Contact-range mate search: same traits, same diet (when dietAssort),
   ready, not yet acted. Independent of eyes - this is touch, not sight. */
function touchMates(w, a, idx){
  const P=w.P, out=[];
  for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
    const x=a.x+dx, y=a.y+dy;
    if(x<0||y<0||x>=P.W||y>=P.H) continue;
    const cell=idx[y*P.W+x]; if(!cell) continue;
    for(const b of cell){
      if(b===a||b.dead||b.acted) continue;
      if(b.legs!==a.legs||b.body!==a.body||b.mouth!==a.mouth||b.eyes!==a.eyes) continue;
      if(b.bigF!==a.bigF) continue;
      if(P.dietAssort && b.carn!==a.carn) continue;
      if(reproReady(w,b)>0) out.push({b,x,y,d:Math.hypot(dx,dy)});
    }
  }
  return out;
}
/* Where would a newborn of guild `carn` go? Own cell if it has room, else
   the nearest vacancy within the mother's leg reach. null = cannot breed. */
function babySlot(w, idx, mom, carn){
  const P=w.P;
  const home=idx[mom.y*P.W+mom.x];
  /* the newborn inherits the mother's build, so its footprint is hers */
  const size=sizeOf(mom,P);
  if(cellHasRoom(w,home,carn,size,null,mom.y*P.W+mom.x)) return {x:mom.x,y:mom.y};
  return freeCellNear(w,idx,mom.x,mom.y,mom.legs,carn,size);
}

/* Trophic conversion: what fraction of a kill becomes predator fat.
   Linear in the predator's sensory-locomotor investment (Joe's rule):
   eyes+legs = 0 -> 0.9, eyes+legs = 20 -> 0.1. */
function convEff(a,P){
  /* DELETED FROM THE GAIN PATH (Joe, 2026-09-01) by returning 1. The old form
     0.9 - 0.04*legs discounted the meal by the PREDATOR's own build, which has
     no support anywhere in the carcass-recovery literature, and its floor of
     0.1 sat far below anything ever measured (worst on record: 78.5% ME on
     whole rodents; measured band 83-95%). Recovery now lives per tissue inside
     preyValue. If a fast or sharp-eyed build should cost, it costs in basal,
     where it does. Returning 1 leaves all three call sites reading the new
     preyValue directly instead of needing edits. */
  if(a.eps!==undefined) return a.eps;          // allele experiments override
  if(!P || !P.legacyEcon) return 1.0;
  const ce=P?P.convEyes:0.04, cl=P?P.convLegs:0.04;
  return 0.9 - ce*a.eyes - cl*a.legs;
}

/* Joe's concealment rule: the prey's silhouette S = legs+body+fat (mouth was
   struck 2026-08-28 - a big mouth is not a big silhouette) against the grass
   on the cell it stands in. Hidden (grass >= S): 10%. Exposed: rises
   linearly to 100% on bare ground. Fat is in S, so a well-provisioned
   animal is a visible one - the only cost fat carries besides being worth
   eating. */
/* Bulk for the intraguild contest: the whole feeding apparatus, deliberately
   a different measure from sizeOf (territory), preyValue (the meal) and basal
   (the running cost), because this is about physically overpowering another
   hunter rather than about ground, food value or metabolism. */
function huntSize(a){ return a.legs+a.body+a.mouth; }

/* `hunter` is optional: without it this is pure concealment - the chance the
   prey is caught if something attacks it - which is what the info panel and
   the microscope want. With it, a carnivore hunting another CARNIVORE is also
   gated on the size gap. */
function catchProb(w,prey,hunter){
  const S=prey.legs+prey.body+prey.fat;
  const g=w.grass[prey.y*w.P.W+prey.x];
  const conceal = g>=S ? 0.10 : 1 - 0.9*(g/Math.max(S,1e-9));
  if(!hunter || !prey.carn || !w.P.intraguildGap) return conceal;
  const gap=(huntSize(hunter)-huntSize(prey))/w.P.intraguildGap;
  return Math.min(conceal, Math.max(0, Math.min(1, gap)));
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
function babyEndow(w,a){
  const P=w.P, up=P.bodyCostPer*basal(a,P);
  const steps = a.bigF ? P.provHighSteps : P.provLowSteps;
  /* three floors: the nominal babyFat, the SURVIVAL floor, and the strategy's
     own allowance. The survival floor is starveBelow + TWO steps of upkeep,
     not one: at one step the newborn lands exactly on starveBelow, where
     floating-point cancellation put 2 of 30 body plans a hair below it and
     killed them on their birth step (measured). Two steps also means a
     newborn always gets to act at least once before it can starve, which is
     the honest meaning of "born alive". */
  return Math.max(P.babyFat, P.starveBelow + 2*up, steps*up);
}
function litterShare(w,a){ return (buildCost(a,w.P)+babyEndow(w,a))/2; }
function reserveFloor(w,a){
  return w.P.starveBelow + w.P.reproReserveSteps*w.P.bodyCostPer*basal(a,w.P);
}
function reproThreshold(w,a){
  return Math.max(buildCost(a,w.P), litterShare(w,a)+reserveFloor(w,a));
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
  for(const p of predators) f += 1/dp1(px,py,p.b.x,p.b.y);
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

  /* EXPLAIN MODE (w.explain, off in every production run): record the state
     an animal decided from and every option it weighed, so a microscope can
     show not just what happened but WHY. Costs nothing when the flag is
     off - a single boolean test per animal per step. */
  const why = w.explain ? {
    step:w.step+1, id:a.id, x:a.x, y:a.y, carn:a.carn, fat:+a.fat.toFixed(3),
    traits:{legs:a.legs, body:a.body, mouth:a.mouth, eyes:a.eyes},
    basal:basal(a,P), upkeep:+(P.bodyCostPer*basal(a,P)).toFixed(3),
    hunger:+h.toFixed(3), drive:+drive.toFixed(3), ready:+r.toFixed(3),
    mateUrge:+mateUrge(w,a,h).toFixed(3), questing:questing,
    reproThreshold:+reproThreshold(w,a).toFixed(2),
    grassHere:+w.grass[a.y*P.W+a.x].toFixed(2),
    exposure:+exposureAt(w,a,a.x,a.y).toFixed(3),
    sees:{ grass:see.grassSpots.length, prey:see.prey.length,
           kin:see.kin.length, mates:see.mates.length,
           predators:see.predators.length },
    options:[]
  } : null;
  const note = why ? (kind,score,parts)=>why.options.push(
      {kind, score:+score.toFixed(3), parts}) : ()=>{};
  if(questing){
    if(a.qt===undefined || a.qt<=0){ a.qdir=w.rnd()*Math.PI*2; a.qt=P.questHold; }
    a.qt--;
  } else a.qt=0;

  /* candidate destinations: stay, plus legs-radius points on 16 bearings
     at full and half stride. Integer cells, deduplicated. */
  /* every cell within reach, plus standing still; offsets are unique so no
     dedup is needed. A full cell it cannot out-size is not offered at all. */
  /* Candidate cells live in three reused typed arrays rather than a fresh
     array of {x,y,d} objects per animal per step - at legs 10 that was ~315
     short-lived objects per animal, every step. CAND_* are module-level and
     only ever grow. */
  let nc=0;
  CAND_X[0]=a.x; CAND_Y[0]=a.y; CAND_D[0]=0; nc=1;
  if(a.legs>0){
    for(const o of MOVE_OFFS[a.legs]){
      const nx=a.x+o.dx, ny=a.y+o.dy;
      if(nx<0||ny<0||nx>=P.W||ny>=P.H) continue;
      if(entryFor(w,idx,a,nx,ny) && clearPath(w,a.x,a.y,nx,ny)){
        CAND_X[nc]=nx; CAND_Y[nc]=ny; CAND_D[nc]=o.d; nc++;
      }
    }
  }

  /* immediate actions on the current cell */
  let best={ kind:'stay', score:-1e9 };
  /* The best thing this animal could do WITHOUT moving. Tracked alongside
     `best` so that a winning stand-still can be collapsed onto a real action
     instead of wasting the turn - see the note at the collapse below. */
  let bestAct=null;
  if(!a.carn){
    const g=w.grass[a.y*P.W+a.x];
    const gain=Math.min(a.mouth,g);
    if(gain>0 && drive>0){
      /* hunger alone prices a meal: a comfortable animal does not eat, so
         fat is bounded near the comfort horizon and grazing pressure tracks
         real metabolic need instead of hoarding without limit */
      const fr=fearAt(w,a,a.x,a.y,see.predators,h);
      const s = drive*gain - fr;
      note('graze', s, {intake:+gain.toFixed(2), drive:+drive.toFixed(3),
                        fear:+fr.toFixed(3)});
      const o={kind:'graze', score:s, gain};
      if(!bestAct || s>bestAct.score) bestAct=o;
      if(s>best.score) best=o;
    }
  } else {
    const here=reachPrey(w,a,idx);
    if(here.length){
      /* weigh EVERY reachable target and take the best, rather than whichever
         happened to be first in the cell list */
      const ce=convEff(a,P), fr=fearAt(w,a,a.x,a.y,see.predators,h);
      let tgt=null, s=-Infinity, cp=0;
      for(const q of here){
        const qcp=catchProb(w,q.b,a), pv=preyValue(q.b,P);
        const risk=P.huntCost*(1-qcp)*(q.b.legs+q.b.body);
        const qs=drive*qcp*ce*pv - risk - fr;
        if(qs>s){ s=qs; tgt=q; cp=qcp; }
      }
      note('hunt', s, {prey:key(tgt.b), catchP:+cp.toFixed(3),
                       efficiency:+ce.toFixed(3), meal:+preyValue(tgt.b,P).toFixed(2),
                       reach:+tgt.d.toFixed(2),
                       drive:+drive.toFixed(3), fear:+fr.toFixed(3)});
      const o={kind:'hunt', score:s, target:tgt.b};
      if(!bestAct || s>bestAct.score) bestAct=o;
      if(s>best.score) best=o;
    }
  }
  if(r>0){
    let near=see.mates.filter(m=>m.d<=1.5 && !m.b.acted && !m.b.dead);
    /* Perception radius is EYES, so mates were only ever found within
       min(eyes,1.5): a blind animal could not breed with the one standing
       on its own square (audit, 2026-08-28). Mating is a contact act - if
       sight found nobody, feel around the 3x3 neighbourhood directly. */
    if(!near.length) near=touchMates(w,a,idx);
    /* A mate action that cannot place a baby burns BOTH parents' turns and
       returns nothing - a permanent livelock for a sessile pair on a full
       cell. Only offer mating when a slot actually exists. */
    if(near.length && !babySlot(w,idx,a,a.carn)) near=[];
    if(near.length){
      /* mating outranks a meal whenever both are possible and the animal is
         ready - the mateWeight scale (risk parameter 3) is what let it walk
         here through fear in earlier steps */
      const fr=fearAt(w,a,a.x,a.y,see.predators,h);
      const s = P.mateWeight*(1+r)*2 - fr;
      note('mate', s, {partner:near[0].b.id, ready:+r.toFixed(3),
                       fear:+fr.toFixed(3)});
      const o={kind:'mate', score:s, partner:near[0].b};
      if(!bestAct || s>bestAct.score) bestAct=o;
      if(s>best.score) best=o;
    }
  }

  /* movement options */
  for(let ci=0; ci<nc; ci++){
    const cX=CAND_X[ci], cY=CAND_Y[ci], cD=CAND_D[ci];
    let v=0;
    if(!a.carn){ for(const g of see.grassSpots) v=Math.max(v,drive*g.v/dp1(cX,cY,g.x,g.y)); }
    else       { for(const p of see.prey)      v=Math.max(v,drive*catchProb(w,p.b,a)*convEff(a,P)*preyValue(p.b,P)/dp1(cX,cY,p.x,p.y)); }
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
    if(r>0) for(const m of see.kin) mv=Math.max(mv, mw*r/dp1(cX,cY,m.x,m.y));
    /* nothing of its own kind in view: travel the chosen bearing, and
       prefer a long stride along it to a short one */
    if(questing && !see.kin.length && a.legs>0 && cD>0){
      const dx=cX-a.x, dy=cY-a.y, len=Math.hypot(dx,dy);
      const dot=(dx*Math.cos(a.qdir)+dy*Math.sin(a.qdir))/len;
      if(dot>0) mv=Math.max(mv, P.questDrive*dot*(len/Math.max(1,a.legs)));
    }
    const fr=fearAt(w,a,cX,cY,see.predators,h);
    const s = v + mv - fr - P.moveCostPer*cD;
    /* the zero-distance candidate is standing still, not moving */
    if(why) note(cD===0 ? 'stay' : ('move '+cX+','+cY), s,
      {food:+v.toFixed(3), mate:+mv.toFixed(3), fear:+fr.toFixed(3),
       travel:+(P.moveCostPer*cD).toFixed(3), dist:+cD.toFixed(2)});
    if(s>best.score) best={kind:'move', score:s, toi:ci};
  }

  /* An animal whose needs cannot be answered by anything in sight WANDERS
     instead of standing still: hungry with no grass in view, or ready to
     breed with no kin in view. Without this, an isolated animal is a
     statue, and reunion of a scattered species is impossible. */
  /* THE WANDER GATE used to open only at an absolute zero score (1e-6). A
     hungry animal standing on a sub-unit crumb of grass scores a positive but
     useless graze (~0.05), so the gate stayed shut and it starved in place
     without taking a single step - measured: a solo L2 B1 M6 E0 at the wall's
     regrowEvery 5 travels 0 cells and dies at step 56, 12 seeds of 12. The
     gate now opens whenever the best thing in reach is not worth one step of
     the animal's own metabolism, which is the honest bar for "nothing here". */
  const idleFloor = P.bodyCostPer*basal(a,P);
  if(best.score<=idleFloor && a.legs>0 && nc>1 &&
     ( (drive>0.2 && (a.carn? !see.prey.length : !see.grassSpots.length)) ||
       (mateUrge(w,a,h)>0.35 && !see.kin.length) )){
    /* same single rnd() draw over the same range as before, so the random
       walk consumes the stream identically */
    best={kind:'move', score:0, toi:1+Math.floor(w.rnd()*(nc-1))};
  }

  /* A WINNING ZERO-DISTANCE CANDIDATE means "this is the best cell to stand
     on". It does NOT mean "do nothing" - but that is what it used to mean,
     because the executor's guard is a positive travel distance, so a winning
     stay fell through every branch and the animal ate nothing, moved nowhere
     and mated with no one. It is structural, not occasional: the perception
     offsets include (0,0), so the animal's own cell enters see.grassSpots at
     distance 0 carrying exactly the graze gain, which makes stay >= graze by
     construction. Grazing survived only on an exact tie broken by evaluation
     order (measured: 99.85% of 151,332 grazes were exact ties), and any kin
     credit or better-looking off-cell grass tipped it into idling - 29.9% of
     ALL decisions were animals refusing a positive meal underfoot, a third of
     those while more than half-starved.
     Collapse a winning stay onto the best action actually available here, and
     when there genuinely is none, call it 'stay' so the microscope can say so
     (the old code reported these as 'move', making 'stay' unreachable). */
  if(best.kind==='move' && CAND_D[best.toi]===0)
    best = bestAct || { kind:'stay', score:best.score };

  if(why){
    /* keep the field of options readable: the winner plus the nine next
       best, which is enough to see what it was weighed against */
    why.options.sort((p,q)=>q.score-p.score);
    why.options=why.options.slice(0,10);
    why.chose=best.kind; why.chosenScore=+best.score.toFixed(3);
    a._why=why; w.whys.push(why);
  }

  /* ---- execute ----
     a.moved is NOT reset here: it is accumulated by relocate() (including
     evictions this animal did not choose) and cleared by the metabolism
     loop once charged. Resetting it here also meant a mating partner was
     billed again for last step's movement. */
  if(best.kind==='graze'){
    const i=a.y*P.W+a.x;
    w.grass[i]=Math.max(0,w.grass[i]-best.gain);
    /* SPECIFIC DYNAMIC ACTION: processing a meal costs 5-15% of what is in it
       (sea lion 9.9-12.4%, mouse 3.9-9.4%). Charged here rather than in basal
       so it scales with what was actually eaten. */
    const sda=(P.legacyEcon?0:P.sdaFrac)*best.gain;
    a.fat+=best.gain-sda;
    w.ledger.grazed+=best.gain; w.ledger.burned+=sda;
  } else if(best.kind==='hunt'){
    if(w.rnd()>=catchProb(w,best.target,a)){
      /* THE HUNT FAILED. The prey fought back or got away, and the attacker
         pays for it in proportion to what it took on. Booked to the ledger as
         burned fat so the mass balance still closes. */
      if(P.huntCost>0){
        const hurt=Math.min(a.fat, P.huntCost*(best.target.legs+best.target.body));
        a.fat-=hurt; w.ledger.burned+=hurt; w.huntsFailed++;
      }
    } else {
      best.target.dead='eaten'; w.eaten++;
      /* stamp the HUNTER with the step it last ate, so a display can flash the
         predator itself rather than the ground. A step count, not a wall
         clock, so the mark lasts the same number of TURNS at any pace. */
      a.ateAt=w.step;
      vital(w, key(best.target), 'eaten');
      const gain=convEff(a,P)*preyValue(best.target,P);
      const sdaH=(P.legacyEcon?0:P.sdaFrac)*gain;      // SDA, as for grazing
      a.fat+=gain-sdaH; w.ledger.burned+=sdaH;
      w.ledger.predGain+=gain;                  // structure + store, x efficiency
      w.ledger.preyFatLost+=best.target.fat;    // the store the prey carried
      /* the diet ledger: what does each carnivore species actually eat */
      const pk=key(a), qk=key(best.target);
      let m=w.preyLog.get(pk); if(!m){ m=new Map(); w.preyLog.set(pk,m); }
      m.set(qk,(m.get(qk)||0)+1);
    }
  } else if(best.kind==='mate'){
    mate(w, a, best.partner, idx);
  } else if(best.kind==='move' && CAND_D[best.toi]>0){
    const tx=CAND_X[best.toi], ty=CAND_Y[best.toi];
    const e=entryFor(w,idx,a,tx,ty);
    if(e){
      const ev=e.evict;            // ENTRY is reused; hold what we need
      if(ev){
        /* take the pixel: the smaller resident is pushed to the nearest
           cell with room. If the map around it is full the contest simply
           fails and the challenger stays put - no animal is deleted by a
           territorial loss. */
        const spot=freeCellNear(w,idx,tx,ty,3,ev.carn,sizeOf(ev,P));
        if(spot){ relocate(w,idx,ev,spot.x,spot.y); w.evictions++; }
        else { a.acted=true; return; }
      }
      relocate(w,idx,a,tx,ty);                 // relocate() bills the distance
    }
  }
  a.acted=true;
}

/* Mating: both partners spend their action; babies keep coming while both
   parents stay above their own reserve threshold. */
function mate(w, mom, dad, idx){
  const P=w.P;
  const build=buildCost(mom,P);            // tracks tissue mass; see buildCost
  /* NOTE: computed from the mother, and correct because identity guarantees
     both parents share her strategy - a baby that flips f/F by mutation is
     provisioned at its parents' rate, which is what a real parent could
     actually decide. */
  const endow=babyEndow(w,mom);          // what the newborn actually receives
  const perParent=(build+endow)/2;
  let made=0;
  /* per baby: the spec gate (fat above build cost) AND the reserve floor
     (survive reproReserveSteps after paying) must hold for both parents */
  while(mom.fat>build && dad.fat>build &&
        mom.fat-perParent>=reserveFloor(w,mom) &&
        dad.fat-perParent>=reserveFloor(w,dad) &&
        w.aliveCount+madeQueue.length<P.maxAnimals){
    /* MUTATION IS ROLLED FIRST. The diet-flip mutation used to fire AFTER
       the slot had been chosen for the mother's guild, so a herbivore pair
       could seat a carnivore newborn in a cell whose carnivore quota was
       already full (audit, 2026-08-28). Traits are settled here, then the
       slot is found for the guild the baby will actually have. */
    const bt={ legs:mom.legs, body:mom.body, mouth:mom.mouth, eyes:mom.eyes,
               bigF:mom.bigF, carn:(w.rnd()<0.5?mom:dad).carn };
    let mutated=false;
    if(w.rnd()<P.mutationP){
      mutated=true; w.mutants++;
      /* six slots now: four morphological traits, the diet flip, and the
         provisioning flip. Each trait's share of mutations therefore falls
         from a fifth to a sixth. */
      const pick=Math.floor(w.rnd()*6);
      if(pick===5){ bt.bigF=!bt.bigF; }
      else if(pick===4){ bt.carn=!bt.carn; if(bt.carn) w.carnFlips++; }
      else{
        const t=['legs','body','mouth','eyes'][pick];
        const lo=(t==='body'||t==='mouth')?1:0;    // the trait floors
        const nv=Math.max(lo,Math.min(10,bt[t]+(w.rnd()<0.5?-1:1)));
        /* An allometrically impossible build is simply not born: the roll is
           still consumed (so the RNG stream does not depend on the rule) but
           the trait keeps its parent value. */
        const cand={legs:bt.legs, body:bt.body, mouth:bt.mouth};
        cand[t]=nv;
        if(t==='eyes' || allometric(P,cand.legs,cand.body,cand.mouth)) bt[t]=nv;
      }
    }
    const baby0carn = bt.carn;
    /* The newborn needs a slot: the parents' own cell if it has room,
       otherwise a free cell within the MOTHER'S LEG REACH (Joe,
       2026-08-28) - dispersal distance is inherited machinery, so a
       sessile L0 pair can only breed into their own pixel while a
       long-legged one can seed a neighbourhood. A pair holding a full
       pixel with no reachable vacancy simply cannot place the offspring,
       so territory limits reproduction directly. */
    const spot = babySlot(w,idx,mom,baby0carn);
    if(!spot) break;
    mom.fat-=perParent; dad.fat-=perParent;
    /* parents pay 2*perParent; the newborn receives only babyFat, so the
       build cost (legs+body+mouth) leaves the world entirely */
    w.ledger.buildLost += 2*perParent - endow;
    w.ledger.babyGot   += endow;
    const baby={ id:w.nextId++, x:spot.x, y:spot.y,
      legs:bt.legs, body:bt.body, mouth:bt.mouth, eyes:bt.eyes,
      bigF:bt.bigF, fat:endow, carn:bt.carn, age:0, moved:0, sinceMate:0,
      founder:mom.founder };
    if(mutated){
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
    vital(w, key(baby), 'births');
    if(made>=6) break;   // engine guard: one pair, one step, six births max
  }
  /* only spend the partner's turn if the pairing actually produced young */
  if(made>0) dad.acted=true;
}
let madeQueue=[];

/* Hit a patch of the world. Returns the event, or null if none fired. */
function disturb(w){
  const P=w.P;
  if(!P.disturbEvery || w.rnd() >= 1/P.disturbEvery) return null;
  /* log-uniform radius: many small events, a few very large ones, which is
     the shape real disturbance regimes have and which stops an independent
     size draw from producing "huge AND frequent" and sterilising the map */
  const lo=Math.max(1,P.disturbDiamLo), hi=Math.max(lo,P.disturbDiamHi);
  const D=lo*Math.pow(hi/lo, w.rnd());
  const R=Math.max(1, Math.round(D/2));        // interior maths works in radii
  const cx=Math.floor(w.rnd()*P.W), cy=Math.floor(w.rnd()*P.H);
  const killF=P.disturbKill;
  const grassF=P.disturbCoupled ? killF : P.disturbGrass;
  let killed=0, burned=0;
  const R2=R*R;
  for(let y=Math.max(0,cy-R); y<=Math.min(P.H-1,cy+R); y++){
    for(let x=Math.max(0,cx-R); x<=Math.min(P.W-1,cx+R); x++){
      const dx=x-cx, dy=y-cy;
      if(dx*dx+dy*dy > R2) continue;
      const i=y*P.W+x;
      if(grassF>0){ const g=w.grass[i]*grassF; w.grass[i]-=g; burned+=g; }
    }
  }
  if(killF>0) for(const a of w.animals){
    if(a.dead) continue;
    const dx=a.x-cx, dy=a.y-cy;
    if(dx*dx+dy*dy > R2) continue;
    if(w.rnd()<killF){
      a.dead='disturbed'; killed++;
      /* its store leaves the world, booked where every other exit is booked
         so the mass-balance identity still closes */
      w.ledger.starvedFat += a.fat;
    }
  }
  w.disturbances++; w.disturbKilled+=killed; w.ledger.grassBurned+=burned;
  w.lastDisturb={ x:cx, y:cy, r:R, step:w.step, killed:killed,
                  grass:+burned.toFixed(1) };
  return w.lastDisturb;
}

/* ---- one world step ------------------------------------------------------ */
function step(w){
  const P=w.P;
  /* disturbance lands BEFORE anyone acts, so survivors get to respond to the
     world it leaves rather than to the one that no longer exists */
  disturb(w);
  if(w.explain) w.whys=[];         // one step's worth, never accumulating
  /* Grass first, and now the land differs: each cell's quality q sets both
     its compounding rate (growLo..growHi) and how fast it re-sprouts from
     bare. Good patches recover quickly and stand tall; poor patches are
     nearly barren. This is what makes a pixel worth defending. */
  const base=1/P.regrowEvery, lo=P.growLo, hi=P.growHi;
  let grew=0;
  for(let i=0;i<w.grass.length;i++){
    const q=w.quality[i], rate=lo+(hi-lo)*q;
    const g=w.grass[i];
    const ng = g<1 ? Math.min(1, g + base*(0.2+0.8*q))
                   : Math.min(P.grassMax, g*(1+rate));
    if(w.blocked && w.blocked[i]) continue;      // bare rock grows nothing
    grew += ng-g; w.grass[i]=ng;
  }
  /* primary production this step - the system's only external input */
  w.ledger.grassGrown += grew;
  /* animals act in a fresh random order every step - a fixed order would
     hand the same animals first pick of grass and mates forever */
  const order=w.animals.filter(a=>!a.dead);
  for(let i=order.length-1;i>0;i--){ const j=Math.floor(w.rnd()*(i+1));
    [order[i],order[j]]=[order[j],order[i]]; }
  const idx=buildIndex(w);
  madeQueue=[];
  for(const a of order){ a.acted=false; }
  for(const a of order){ if(a.dead||a.acted) continue; act(w,a,idx); }
  /* metabolism + death, then the newborns join.
     NEWBORNS ARE INCLUDED (Joe's action order, 2026-08-28): a baby used to
     get one free step - no upkeep, no action, but fully edible. It now pays
     its first step like everything else, which the scaled endowment covers. */
  for(const a of order.concat(madeQueue)){
    if(a.dead) continue;
    /* basal floor: metabolism charges at least one body unit - a body-0
       animal still runs its machinery. Without this, mouth-fed grazing
       made B0 a zero-upkeep body plan and two of three test seeds hit the
       population cap on it (measured). */
    /* Movement is charged in proportion to the animal's OWN basal, not flat.
       Within an individual, loaded animals' oxygen use rises in exact
       proportion to supported mass (Taylor 1980); across species cost per metre
       scales M^0.72 while BMR scales M^0.69, so the two cancel and locomotion
       is a near-constant fraction of an animal's own basal at every size. The
       old flat charge was backwards - ruinous for a small animal, trivial for
       a large one. */
    const bs = basal(a,P);
    const burn = (P.legacyEcon ? P.moveCostPer*a.moved
                               : P.moveCostPer*a.moved*(bs/P.basalRef))
               + P.bodyCostPer*bs;
    a.fat -= burn; w.ledger.burned += burn;
    a.moved=0;                    // paid for; the next step starts from zero
    a.age++;
    a.sinceMate=(a.sinceMate||0)+1;
    if(a.fat<P.starveBelow){ a.dead='starved'; w.starved++;
      vital(w, key(a), 'starved');
      w.ledger.starvedFat += a.fat;             // whatever store it still held
      if(a.carn){ w.carnStarved++; w.carnAgeSum+=a.age; } }
    else if(P.mortality>0 && w.rnd()<P.mortality){
      /* died of something the model does not simulate */
      a.dead='mortality'; w.diedOfAge++;
      vital(w, key(a), 'background');
      w.ledger.starvedFat += a.fat;             // its store leaves the world too
    }
  }
  /* a newborn eaten on its birth step used to be concatenated in anyway and
     counted alive by stats() for one full step (audit, 2026-08-28) */
  w.animals=w.animals.filter(a=>!a.dead).concat(madeQueue.filter(a=>!a.dead));
  w.aliveCount=w.animals.length;
  /* close the vital-rate window and start a fresh one */
  if(++w.vitalSteps>=P.vitalWindow){
    w.vitalPrev=w.vitalCur; w.vitalCur=new Map(); w.vitalSteps=0;
  }
  w.step++;
}

/* ---- observation --------------------------------------------------------- */
function stats(w){
  const sp=new Map(); let herb=0,carn=0,fat=0;
  /* Ages collected per species so the panel can show a MEDIAN age - the
     mean is dragged around by the handful of very old survivors every
     population carries, while the median says what a typical member's life
     actually looks like. One extra array push per animal plus a sort per
     species; measured at well under a millisecond for 25,000 animals, and
     stats() runs once a frame, not once a step. */
  const ages=new Map();
  for(const a of w.animals){
    const k=key(a);
    sp.set(k,(sp.get(k)||0)+1);
    let a2=ages.get(k); if(!a2){ a2=[]; ages.set(k,a2); }
    a2.push(a.age);
    if(a.carn)carn++; else herb++;
    fat+=a.fat;
  }
  let g=0, gCells=0;
  for(let i=0;i<w.grass.length;i++){ g+=w.grass[i]; if(w.grass[i]>=1) gCells++; }
  const list=[...sp.entries()].sort((a,b)=>b[1]-a[1]).map(([k,count])=>{
    const t=parseKey(k), carn=t.carn;
    const e={ key:k, count, carn, legs:t.legs, body:t.body, mouth:t.mouth,
              eyes:t.eyes, bigF:t.bigF };
    const ag=ages.get(k);
    if(ag && ag.length){
      ag.sort((x,y)=>x-y);
      const m=ag.length>>1;
      e.medianAge = ag.length%2 ? ag[m] : Math.round((ag[m-1]+ag[m])/2);
    }
    /* Vital rates over the last closed window (fall back to the window still
       filling, so a fresh world is not blank). R is births per step as a
       percentage of the species' CURRENT headcount; S/B/P split this
       species' deaths by cause. */
    const vw = w.vitalPrev.size? w.vitalPrev : w.vitalCur;
    const span = w.vitalPrev.size? w.P.vitalWindow : Math.max(1,w.vitalSteps);
    const v = vw.get(k);
    if(v){
      e.R = count? +(100*v.births/(span*count)).toFixed(2) : 0;
      const d = v.starved+v.background+v.eaten;
      e.deaths = d;
      if(d){
        e.S = Math.round(100*v.starved/d);
        e.B = Math.round(100*v.background/d);
        e.P = Math.round(100*v.eaten/d);
      }
    }
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
           evictions:w.evictions, diedOfAge:w.diedOfAge,
           huntsFailed:w.huntsFailed,
           disturbances:w.disturbances, disturbKilled:w.disturbKilled,
           lastDisturb:w.lastDisturb,
           carnFlips:w.carnFlips, carnBorn:w.carnBorn, carnStarved:w.carnStarved,
           carnMeanAge: w.carnStarved? +(w.carnAgeSum/w.carnStarved).toFixed(1):0,
           fatMean: w.animals.length? +(fat/w.animals.length).toFixed(2) : 0,
           list,
           topSpecies: [...sp.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5) };
}

/* the microscope needs to build animals and read the model's own verdicts */
function makeAnimal(w, spec){
  /* floors were enforced but not ceilings, and x,y were not bounded at all:
     eyes or legs outside 0..10 indexed past MOVE_OFFS and crashed step(),
     and an off-grid animal read another cell's grass (audit, 2026-08-28) */
  const cl=(v,lo)=>Math.max(lo,Math.min(10,v|0));
  const a={ id:w.nextId++,
    x:Math.max(0,Math.min(w.P.W-1,spec.x|0)),
    y:Math.max(0,Math.min(w.P.H-1,spec.y|0)),
    legs:cl(spec.legs,0), body:cl(spec.body,1),
    mouth:cl(spec.mouth,1), eyes:cl(spec.eyes,0), bigF:!!spec.bigF,
    fat:spec.fat===undefined?8:+spec.fat, carn:!!spec.carn,
    age:0, moved:0, sinceMate:0, founder:spec.name||'placed' };
  w.animals.push(a); return a;
}
global.Eco = { newWorld, step, stats, DEFAULTS, key, parseKey, makeAnimal,
  catchProbFor:catchProb,
  /* the same verdicts the engine uses, exposed for inspection */
  info:(w,a)=>({ basal:basal(a,w.P), upkeep:w.P.bodyCostPer*basal(a,w.P),
    hunger:hunger(w,a), ready:reproReady(w,a), urge:mateUrge(w,a),
    threshold:reproThreshold(w,a), litterShare:litterShare(w,a),
    reserveFloor:reserveFloor(w,a), convEff:convEff(a,w.P),
    exposure:exposureAt(w,a,a.x,a.y), catchProb:catchProb(w,a),
    size:sizeOf(a,w.P) }) };
})(typeof window!=='undefined' ? window : globalThis);
