# Game move simulation function
_Exported on 5/10/2026 at 16:04:55 EDT from Cursor (3.2.16)_

---

**User**

The function calculate_heuristric() on line 99 takes an input of a possible state, the player we are calculating the heuristic for, and an array of weights for each factor.
Generate a function simulate() that takes a board state, the player who has the current turn, and a weights vector and returns the best move, based on the score returned by calculate_heuristic.

---

**Cursor**

Got it. I’m going to inspect how your board state is represented and how legal moves are generated/applied, then I’ll implement `simulate(boardState, currentPlayer, weights)` to enumerate legal moves, score each resulting state via `calculate_heuristic`, and return the highest-scoring move for the current player.

Next I’m going to locate how your code represents a “move” and how it generates/apply-copies candidate next states, so `simulate()` can reuse those helpers instead of guessing rules.

I found that your heuristic only looks at `state.settlements` (income) and `state.playerStats` (vp), so `simulate()` can be implemented by trying candidate settlement placements and city upgrades, scoring each resulting state with `calculate_heuristric`, and returning the argmax move. I’m going to add it right after `calculate_heuristric()`.

### What I added

- Implemented `simulate(state, playerToMove, weights)` in `js/script.js`.
- It tries two move types, scores each resulting state with `calculate_heuristric(nextState, playerToMove, weights)`, and returns the best one:
  - **`build_settlement`**: place a settlement (`buildingType: 1`) on any unoccupied corner from `mapState.tileCornerStates`
  - **`upgrade_city`**: upgrade any owned settlement (`buildingType: 1`) into a city (`buildingType: 2`)
- Return shape: **`{ type, key, corner, score }`** (or `null` if no candidates exist)

### Where it lives

`/home/tzheng12/Spring 2026/CMSC471/fp/cmsc471-final/js/script.js` right after `calculate_heuristric()`.

If you want “best move” to mean *only legal moves* (distance rule, road connectivity, resources cost, etc.), tell me which rule set you want enforced and where that data is stored in `state`, and I’ll tighten the candidate-move generator accordingly.

---

**User**

In addition to placing settlements and upgrading settlements, I want to also consider placing roads or "buying development cards" (spends 1 sheep, 1 wheat, 1 ore).
Make sure that any simulated move which places a structure deducts the correct amount of resources.
Road costs 1 wood, 1 brick
Settlement costs 1 wood, 1 brick, 1 wheat, 1 sheep
Upgrading settlement to city costs 2 wheat, 3 ore.

---

**Cursor**

I’m going to inspect how `state.playerResources` is represented in your saved turn states (array vs count map), then I’ll update `simulate()` to add road/dev-card moves and to correctly deduct resources (and skip moves you can’t afford).

### Updated `simulate()` to include roads + dev cards + resource costs

In `js/script.js`, `simulate(state, playerToMove, weights)` now considers **4 move types** and **skips any move you can’t afford** by checking/deducting from `state.playerResources[player]`:

- **`build_settlement`**: costs **1 wood, 1 brick, 1 sheep, 1 wheat**
- **`upgrade_city`**: costs **2 wheat, 3 ore**
- **`build_road`**: costs **1 wood, 1 brick**
- **`buy_dev_card`**: costs **1 sheep, 1 wheat, 1 ore**

### Notes about resource representation (handled)

Your analytics turn states store resources as an **array of ids** (e.g. `[1,4,4,5,...]`), so deduction removes those ids. I also made it work if you ever pass a **count-map** like `{ wood: 2, brick: 1, ... }`.

### Return value

Still returns the best-scoring move object like:

- `{ type: "build_settlement", key, corner, score }`
- `{ type: "upgrade_city", key, corner, score }`
- `{ type: "build_road", key, edge, score }`
- `{ type: "buy_dev_card", key: null, score }`

If you want road placement to also obey **connectivity rules** (must connect to your existing road/settlement) or settlement placement to obey the **distance rule**, tell me what data structure you want to use for legality checks (your `state.roads` + `state.settlements` is enough), and I’ll enforce those too.

---

**User**

Road placement must obey connectivity rules, and settlements cannot be placed adjacent to any other existing settlement or city (including your own).

---

**Cursor**

I’m going to wire up two legality checks inside `simulate()`: (1) settlement placements will be filtered using a corner-adjacency graph so no new settlement/city is adjacent to any existing one, and (2) road placements will only be considered if the edge connects to your existing road network (roads or your own settlement/city), with opponent settlements blocking “road-to-road” connectivity through that vertex.

### Legality rules added to `simulate()`

I updated `simulate()` in `js/script.js` to enforce both constraints you asked for:

- **Settlement placement (distance rule)**: `build_settlement` is only considered if the target corner is empty **and none of its adjacent corners** (connected by an edge) has *any* settlement/city (yours or others).
- **Road placement (connectivity rule)**: `build_road` is only considered if the edge is empty **and** it connects to your existing network:
  - **Always OK** if it touches a corner where you already have a settlement/city.
  - Otherwise OK if it touches an endpoint that is already an endpoint of one of your roads, **as long as that endpoint isn’t occupied by an opponent settlement/city** (opponent buildings block “road-to-road” connectivity through that vertex).

Resource deductions + affordability checks from earlier are still applied to every structure/dev-card move.

---

**User**

My heuristic currently doesn't favor developing longer roads. Add to calculate_heuristric() a factor modeled by a function roads() that would consider longer roads, and adjust sample_weight to include and addition weight. Also add to the comments on lines 6-13 to explain how roads() is calculated.

---

**Cursor**

I’m going to extend the heuristic with a new `roads()` factor (based on the player’s current longest-road length), update `sample_weight` to include its weight, and then wire it into `calculate_heuristric()` and the top-of-file comment block.

### Heuristic now rewards longer roads

I updated `js/script.js` to add a new factor `roads()` and included it in `calculate_heuristric()`.

- **`roads(state, player)`**: pulls `state.playerStats[player].longestRoad` and returns \(L^2\) (squaring makes longer roads increasingly valuable).
- **`sample_weight`**: extended to **7 weights** (added a roads weight at the end).
- **`calculate_heuristric()`**: now uses `w[6] * roadsVal` (and falls back to `sample_weight[6]` if no weights vector is provided).
- **Top comment (lines 6–13)**: extended to explain how `roads()` is calculated.

---

**User**

Comments 141-150 define a move as building a settlement or upgrading an existing one to a city. I wanted to include building roads and buying development cards as possible moves, too. Verify that simulate() considers all four possibilities.

---

**Cursor**

I’m going to re-open the `simulate()` section and confirm it enumerates **settlement**, **city upgrade**, **road**, and **dev card** moves, and I’ll update the header comment if it’s still outdated.

### Verification

Yes—`simulate()` currently considers **all four** move types:

- **Settlement**: Candidate 1 (`type: "build_settlement"`)  
- **City upgrade**: Candidate 2 (`type: "upgrade_city"`)  
- **Road**: Candidate 3 (`type: "build_road"`)  
- **Dev card**: Candidate 4 (`type: "buy_dev_card"`)

You can see the four candidate loops/blocks here:

```353:440:/home/tzheng12/Spring 2026/CMSC471/fp/cmsc471-final/js/script.js
// Candidate 1: build settlement ...
// Candidate 2: upgrade ... to a city.
// Candidate 3: place a road ...
// Candidate 4: buy a development card ...
```

### Comment fix

The comment at lines 141–150 was outdated; I updated it to list **roads** and **buying development cards** as move types too.

---

**User**

Verify that simulate() only considers legal moves (the current player has enough resources to build/upgrade or buy development card). Also verify that simulate() is not attempting to build on occupied spaces or build new settlements adjacent to other settlements. Also verify that a new settlement is connected to an existing road (that the player owns).

---

**Cursor**

I’m going to inspect the current settlement-candidate logic in `simulate()` and tighten it so settlements are only considered if they’re at the end of one of the current player’s roads, while keeping the existing affordability + occupancy + distance-rule checks.

### Verified: legality + occupancy + adjacency + settlement connectivity

- **Enough resources / legal purchase**: Yes. Every move type calls `canAffordAndDeduct(nextState, COST.<...>)`, and `continue`s if it returns false:
  - Settlement: `COST.settlement`
  - City: `COST.city`
  - Road: `COST.road`
  - Dev card: `COST.devCard`

- **Not building on occupied spaces**: Yes.
  - Settlement skips `if (occ?.owner) continue;`
  - Road skips `if (occ?.owner) continue;`
  - City upgrade only targets owned settlements with `buildingType === 1`

- **No new settlement adjacent to any settlement/city**: Yes. `canPlaceSettlementAt()` checks all neighboring corners (via the corner adjacency graph derived from edges) and rejects if any neighbor is occupied.

- **New settlement connected to an existing road the player owns**: Yes now. `canPlaceSettlementAt()` also requires `settlementConnectsToOwnedRoad(cornerKey)` (i.e., at least one incident edge has a road owned by the current player).

---

**User**

Note that it is possible to build a settlement in the middle of your own road as long as it is two roads/edges away from any other settlements

---

**Cursor**

You’re right—that case should be legal. The good news is the settlement rule I added already allows “middle of your road” placement, because it only requires an **incident owned road edge at that corner** (not that it’s an endpoint). I’ll just tweak the comment to make that explicit so it’s not misleading.

That scenario is **already allowed** by the current `simulate()` logic.

- **Distance rule**: we only forbid settlements on **adjacent corners** (1 edge away), which matches “two edges away from any other settlement/city”.
- **Road connectivity**: we require the corner to have **at least one incident road edge owned by the player**. If the corner is in the “middle” of your road, it typically has **two** incident owned roads, so it passes.

I updated the in-code comment to explicitly note that we **do not require an endpoint**, so “middle of your road network” settlement placement is supported.

---

**User**

Verify that simulating moves accounts for added victory point before calculating heuristic. Building a road should check for longest road, building settlement should add point, upgrading to city should add a point.

---

**Cursor**

Searching for `simulate`, `bumpVp`, longest-road VP logic, and how turn states represent VP.



Confirming settlements and cities call `bumpVp(nextState, 1)` before `calculate_heuristric`. Road builds don't update VP or longest-road stats. Implementing geometric longest-road computation, syncing `stats.longestRoad`, and adjusting VP (+/-2) when the longest-road holder changes.



Implementing longest-road helpers and integrating them into the road branch of `simulate()`.



Making `bumpVp` robust if `stats.vp` isn't initialized — otherwise settlement/city simulated VP wouldn't update.



### What was already correct

**Settlement (`build_settlement`)** and **city (`upgrade_city`)** both mutate the cloned state **before** `calculate_heuristric`:

- They apply the board piece, call `bumpVp(nextState, 1)` (**+1 VP** vs the previous settlement; city is settlement +1 VP), then score.

So VP from those moves already feeds into the heuristic’s `vp(...)` term.

### What was missing (fixed)

**Road (`build_road`)** only updated `nextState.roads` and scored; it never updated **`stats.longestRoad`** or the **±2 VP** for longest-road. That’s implemented now via:

- **`computeLongestRoadLengthsByPlayer`** – longest contiguous road segment per player via DFS over that player’s road edges (opponent settlements block turning at a junction, matching standard Catan).
- **`pickLongestRoadHolder`** – needs **≥ 5 segments**; unique max wins; ties use existing `stats.longestRoad`, then lowest player id.
- **`applyLongestRoadAfterSimulatedRoad`** – runs **after** the new road is on `nextState`, **before** `calculate_heuristric`: refreshes **`longestRoad` for each player** in `playerStats`, then **−2 VP** for the old holder (if holder changes) and **+2 VP** for the new one.

Also **`bumpVp`** now treats non-numeric VP as **0**, so simulated settlement/city still add a point even if `vp` was unset.

So for every move type scored by `simulate()`, **`vp(state)` / `roads(state,...)` reflect the simulated board (and VP swings for longest road on road builds)** before the heuristic runs.