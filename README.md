# Selection - an evolving ecology

An agent-based community-ecology and evolution simulation. Grass grows on a
160 x 90 grid; animals carry five species-identifying traits and a continuous
fat store, and mating requires an exact match on every one of them - so a
species here is not a label anyone assigned, it is a trait-identity, and every
mutation is a step toward reproductive isolation.

**Watch it run: https://worldbyjoe.github.io/selection-abm/**

The five are four integers - legs, body, mouth, eyes - plus a binary
provisioning strategy written `f` or `F`, and diet on top of them. A species
is written as a dotted key, `L6.B6.M4.E1.f.H`: six legs, six body, four mouth,
one eye, cheap provisioning, herbivore. That key is the label on every table
row and every line of exported data.

Eight founding populations wake in the four corners - a grazer and a hunter
in each, the hunter's mouth drawn wide enough for its neighbour grazer's body
so it is at least viable. Everything after that is emergent: the boom, the
overgrazed bust, the radiation into dozens of coexisting species, and whether
the predator guild holds on or goes under.

## The rules that matter

- **Concealment predation**: a prey animal standing in grass taller than its
  own size (legs + body + fat) is caught only 10% of the time; on bare
  ground, always. An overgrazed commons is a killing field, fat is a
  visibility cost, and tall grass is worth fighting over. Note what is NOT in
  that size: the mouth. A big mouth makes you hungry, not conspicuous.
- **The gape gate**: a predator's mouth must strictly exceed its prey's body.
  A large enough grazer is too big to eat - a size refuge that evolution may
  or may not find.
- **The intraguild gap**: eating another carnivore takes more than a wide
  mouth. The hunter needs an edge in legs + body + mouth, and its chance is
  the lower of that edge and what concealment allows - so carnivore-on-
  carnivore predation is rare and one-sided rather than a free-for-all.
- **Allometry**: legs, body and mouth must stay within two units of each
  other. Eyes are exempt. Without it evolution finds absurd builds - a
  ten-mouth, one-body animal - that win on the arithmetic and could not
  stand up.
- **Trophic efficiency**: a kill converts prey biomass to predator fat at
  0.9 - 0.04 x legs, so a sessile ambusher keeps 86% of a meal and a maximal
  courser 50%. Sight is not taxed: eyes cost upkeep every step, and charging
  them twice made them extinct.
- **The mouth feeds, both diets**: grazing gains min(mouth, grass) - a
  mouthless animal starves, and a large body needs a large mouth.
- **Provisioning, f or F**: `f` gives a newborn four steps of its own upkeep
  as a starting fat reserve, `F` gives it ten. Cheap offspring are many and
  fragile, expensive ones are few and robust, and because the trait is part
  of the species identity the two strategies cannot interbreed and have to
  compete.
- **Trait-identity mating**: partners must match on all five traits and on
  diet, and both must hold enough fat to build the offspring plus a reserve
  for themselves. Mate scarcity gives rare species a real Allee effect: their
  growth stays suppressed until numbers cross the threshold where partners
  are findable.
- **Mutation**: 5% of births, with six equally likely outcomes - one of the
  four integer traits shifts by one unit, or the diet flips, or the
  provisioning strategy flips.
- **Disturbance and walls**: a run may be dealt periodic disturbances, each
  clearing a patch of the map of most of its animals and most of its grass,
  and it may be dealt hard walls that block movement outright rather than
  merely occupancy. Both are drawn per world. Together they are the largest
  single lever on how many species coexist.

## Reading the screen

Every species wears a colour mixed from its own traits as CMYK ink - legs
cyan, body magenta, mouth yellow - and the black channel carries eyes and
provisioning, roughly half each, so an `F` species is markedly darker than
its `f` trait-twin. Similar species look similar, and the community strip's
colour gradients are trait gradients.

Carnivores are pulled toward red and ringed in red on the map, and a predator
flashes yellow for a moment when it makes a kill. The strip along the bottom
is the whole run's community composition, compressed as it grows: left edge
founding, right edge now. The table lists the ten most common species by their
dotted key, with each one's birth rate and the share of its deaths that came
from starvation, background mortality and predation; predator rows name their
top prey.

Keys: **p** or space pause · **n** new world · **s** start · **1 2 3** speed.

## Running it

Open `index.html` in a browser, or follow the link above. The page is the
laboratory version: the panel on the left sets up a world before you start it
- landscape, mortality, provisioning, the intraguild gap, disturbance, walls -
and the defaults are the ones the model ships with. Press start, or `s`.

## The rest of them

This piece belongs to a wall of simulations, all of them single HTML files:
[worldbyjoe.github.io/tv-art-display](https://worldbyjoe.github.io/tv-art-display/).

## Provenance

Generated by script from the author's development copy; the simulation engine
(`ecology_engine.js`) is pure and deterministic - a seeded run replays exactly
- and is balance-tested headless before anything ships.
