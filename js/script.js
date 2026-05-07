// ── HEURISTIC ──────────────────────────────────────────────────────────────
// roll_probability[sum] = probability of rolling that; i.e. roll_probability[7] = 6/36
const roll_probability = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
const sample_weight = [5.0, 3.0, 4.0, 2.5, 2.0, 2.0, 1.5];

/* Given a game state, calculate the heuristic based on the function(s).
 * income: for each resource, returns sum(probability * # of adjacent settlements)
 * variety: number of resource types with income > 0 (may want to adjust this threshold)
 * expansion: sum(probabilities of available settlement locations)
 * dev_card: min(ore income, wheat income, sheep income)
 * vp: current number of vp
 * robber_risk: if number of cards in hand > 7, then (roll_probability[7] * number of cards in hand / 2) ("discard income")
 * roads: uses playerStats.longestRoad (if present) and squares it (L^2) so longer road networks
 *        are increasingly preferred over incremental road growth
 */

// order of resources based on RESOURCE_TYPES = ["wood", "brick", "sheep", "wheat", "ore"]
function income(state, player) {
    const mapState = resolve_heuristic_map_state(state);
    const hexes = mapState.tileHexStates ? Object.values(mapState.tileHexStates) : [];
    const settlements = state.settlements ?? {};
    const pid = Number(player);
    const res = [0, 0, 0, 0, 0];

    for (const piece of Object.values(settlements)) {
        if (!piece?.owner || Number(piece.owner) !== pid) continue;
        if (piece.buildingType !== 1 && piece.buildingType !== 2) continue;
        const prod = piece.buildingType === 2 ? 2 : 1;
        const touches = heuristic_touching_hexes(
            { x: piece.x, y: piece.y, z: piece.z },
            hexes
        );
        for (const h of touches) {
            const t = h.type;
            if (t < 1 || t > 5) continue;
            const dn = Number(h.diceNumber);
            const p = dn >= 2 && dn <= 12 ? roll_probability[dn] : 0;
            if (p === 0) continue;
            res[t - 1] += p * prod;
        }
    }
    return res;
}

function variety(incomeVec, threshold) {
    let n = 0;
    for (const v of incomeVec) {
        if (v > threshold) n += 1;
    }
    return n;
}

function expansion(state, player) {
    const mapState = resolve_heuristic_map_state(state);
    const cornerEntries = mapState.tileCornerStates
        ? Object.entries(mapState.tileCornerStates)
        : [];
    const hexes = mapState.tileHexStates ? Object.values(mapState.tileHexStates) : [];
    const settlements = state.settlements ?? {};
    let sum = 0;

    for (const [cornerKey, baseCorner] of cornerEntries) {
        const occ = settlements[cornerKey];
        if (occ?.owner) continue;

        const spot = {
            x: occ?.x ?? baseCorner.x,
            y: occ?.y ?? baseCorner.y,
            z: occ?.z ?? baseCorner.z,
        };
        const touches = heuristic_touching_hexes(spot, hexes);
        for (const h of touches) {
            const dn = Number(h.diceNumber);
            const p = dn >= 2 && dn <= 12 ? roll_probability[dn] : 0;
            sum += p;
        }
    }
    return sum;
}

function dev_card(income) {
    let dev_card_resources = [income[2], income[3], income[4]];
    return Math.min(...dev_card_resources);
}

function vp(state, player) {
    const stats =
        state.playerStats?.[player] ?? state.playerStats?.[String(player)] ?? null;
    return stats?.vp ?? 0;
}

function robber_risk(state, player) {
    const cards =
        state.playerResources?.[player] ?? state.playerResources?.[String(player)];
    const n = Array.isArray(cards) ? cards.length : 0;
    if (n <= 7) return 0;
    return roll_probability[7] * (n / 2);
}

function roads(state, player) {
    const stats =
        state.playerStats?.[player] ?? state.playerStats?.[String(player)] ?? null;
    const L = Number(stats?.longestRoad ?? 0);
    if (!Number.isFinite(L) || L <= 0) return 0;
    return L * L;
}

// state = current game state; player = player we are calculating heuristic for, w = weights
function calculate_heuristric(state, player, w) {
    const incomeVec = income(state, player);
    const income_sum = incomeVec.reduce((acc, curr) => acc + curr, 0);
    const varietyVal = variety(incomeVec, 0);
    const expansionVal = expansion(state, player);
    const devCardVal = dev_card(incomeVec);
    const vpVal = vp(state, player);
    const robberVal = robber_risk(state, player);
    const roadsVal = roads(state, player);

    if (Array.isArray(w) && w.length >= 7) {
        return (
            w[0] * income_sum +
            w[1] * varietyVal +
            w[2] * expansionVal +
            w[3] * devCardVal +
            w[4] * vpVal -
            w[5] * robberVal +
            w[6] * roadsVal
        );
    }
    return (
        sample_weight[0] * income_sum +
        sample_weight[1] * varietyVal +
        sample_weight[2] * expansionVal +
        sample_weight[3] * devCardVal +
        sample_weight[4] * vpVal -
        sample_weight[5] * robberVal +
        sample_weight[6] * roadsVal
    );
}

// Given a board state and the player to move, choose the move that maximizes
// calculate_heuristric(nextState, playerToMove, weights).
//
// A "move" here is one of:
// - build_settlement: place a settlement (buildingType=1) on an empty corner
// - upgrade_city: upgrade an owned settlement (buildingType=1) to a city (buildingType=2)
// - build_road: place a road (type=1) on an empty edge (must connect to your network)
// - buy_dev_card: spend 1 sheep, 1 wheat, 1 ore (no board geometry changes simulated)
//
// Returns:
//   { type, key, corner?, score }
// or null if no candidate moves exist.
function simulate(state, playerToMove, weights) {
    const mapState = resolve_heuristic_map_state(state);
    const pid = Number(playerToMove);
    if (!Number.isFinite(pid)) return null;

    const baseSettlements = state?.settlements ?? {};
    const baseRoads = state?.roads ?? {};
    const cornerEntries = mapState?.tileCornerStates ? Object.entries(mapState.tileCornerStates) : [];
    const edgeEntries = mapState?.tileEdgeStates ? Object.entries(mapState.tileEdgeStates) : [];

    // --- Precompute corner px + edge endpoints so we can enforce:
    // (a) settlement distance rule (no adjacent settlement/city),
    // (b) road connectivity (must connect to your network; opponent buildings block pass-through).
    const cornerPxByKey = new Map();
    for (const [cornerKey, c] of cornerEntries) {
        cornerPxByKey.set(cornerKey, heuristic_corner_px(c));
    }

    const cornerKeyNearPx = (pt) => {
        // O(N) is fine at Catan board sizes.
        const EPS = SIZE * 0.05 + 1e-9;
        const eps2 = EPS * EPS;
        let bestKey = null;
        let bestD2 = Infinity;
        for (const [k, p] of cornerPxByKey.entries()) {
            const dx = p.x - pt.x;
            const dy = p.y - pt.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
                bestD2 = d2;
                bestKey = k;
            }
        }
        return bestD2 <= eps2 ? bestKey : null;
    };

    const edgeEndpointsCornerKeys = (edgeLike) => {
        const { px, py } = axialToPixel(edgeLike.x, edgeLike.y);
        const eIdx = EDGE_Z_TO_IDX[edgeLike.z] ?? EDGE_Z_TO_IDX[0];
        const v0 = hexVertex(px, py, eIdx);
        const v1 = hexVertex(px, py, (eIdx + 1) % 6);
        const k0 = cornerKeyNearPx(v0);
        const k1 = cornerKeyNearPx(v1);
        return k0 && k1 ? [k0, k1] : null;
    };

    const cornerAdj = new Map(); // cornerKey -> Set(neighborCornerKey)
    const edgeEndpointsByKey = new Map(); // edgeKey -> [c0, c1]
    const incidentEdgesByCorner = new Map(); // cornerKey -> Set(edgeKey)
    for (const [edgeKey, e] of edgeEntries) {
        const ends = edgeEndpointsCornerKeys(e);
        if (!ends) continue;
        edgeEndpointsByKey.set(edgeKey, ends);
        const [a, b] = ends;
        if (!cornerAdj.has(a)) cornerAdj.set(a, new Set());
        if (!cornerAdj.has(b)) cornerAdj.set(b, new Set());
        cornerAdj.get(a).add(b);
        cornerAdj.get(b).add(a);
        if (!incidentEdgesByCorner.has(a)) incidentEdgesByCorner.set(a, new Set());
        if (!incidentEdgesByCorner.has(b)) incidentEdgesByCorner.set(b, new Set());
        incidentEdgesByCorner.get(a).add(edgeKey);
        incidentEdgesByCorner.get(b).add(edgeKey);
    }

    const cornerOwner = new Map(); // cornerKey -> ownerNumber
    for (const [cornerKey, piece] of Object.entries(baseSettlements)) {
        if (piece?.owner) cornerOwner.set(cornerKey, Number(piece.owner));
    }

    const ownedRoadEdges = [];
    for (const [edgeKey, piece] of Object.entries(baseRoads)) {
        if (piece?.owner && Number(piece.owner) === pid && piece.type === 1) ownedRoadEdges.push(edgeKey);
    }
    const ownedRoadEdgeSet = new Set(ownedRoadEdges);

    const ownedRoadEndpointCorners = new Set();
    for (const edgeKey of ownedRoadEdges) {
        const ends = edgeEndpointsByKey.get(edgeKey) ?? edgeEndpointsCornerKeys(baseRoads[edgeKey]);
        if (!ends) continue;
        ownedRoadEndpointCorners.add(ends[0]);
        ownedRoadEndpointCorners.add(ends[1]);
    }

    const ownedBuildingCorners = new Set();
    for (const [cornerKey, piece] of Object.entries(baseSettlements)) {
        if (piece?.owner && Number(piece.owner) === pid) ownedBuildingCorners.add(cornerKey);
    }

    const settlementConnectsToOwnedRoad = (cornerKey) => {
        const inc = incidentEdgesByCorner.get(cornerKey);
        if (!inc) return false;
        for (const edgeKey of inc) {
            if (!ownedRoadEdgeSet.has(edgeKey)) continue;
            // Note: This allows settlements in the "middle" of your road network too
            // (a corner can have 2 incident owned roads); we do NOT require an endpoint.
            const occ = cornerOwner.get(cornerKey);
            if (occ !== undefined && occ !== pid) continue;
            return true;
        }
        return false;
    };

    const canPlaceSettlementAt = (cornerKey) => {
        if (cornerOwner.has(cornerKey)) return false;
        const neigh = cornerAdj.get(cornerKey);
        if (!neigh) return true; // isolated (shouldn't happen), but safe.
        for (const nk of neigh) {
            if (cornerOwner.has(nk)) return false; // adjacent to any existing settlement/city
        }
        // Must be connected to the player's existing road network (settlement built at end of road).
        if (!settlementConnectsToOwnedRoad(cornerKey)) return false;
        return true;
    };

    const roadConnectsToNetwork = (edgeKey) => {
        const ends = edgeEndpointsByKey.get(edgeKey);
        if (!ends) return false;
        const [a, b] = ends;

        // If either endpoint has our building, it's connected.
        if (ownedBuildingCorners.has(a) || ownedBuildingCorners.has(b)) return true;

        // Otherwise it must connect to an existing owned road at an endpoint that
        // is NOT occupied by an opponent building (opponent blocks pass-through).
        const occA = cornerOwner.get(a);
        const occB = cornerOwner.get(b);
        const aBlocked = occA !== undefined && occA !== pid;
        const bBlocked = occB !== undefined && occB !== pid;

        if (!aBlocked && ownedRoadEndpointCorners.has(a)) return true;
        if (!bBlocked && ownedRoadEndpointCorners.has(b)) return true;
        return false;
    };

    // Resource ids (Colonist): 1=wood, 2=brick, 3=sheep, 4=wheat, 5=ore
    const COST = {
        road: [1, 2],
        settlement: [1, 2, 3, 4],
        city: [4, 4, 5, 5, 5],
        devCard: [3, 4, 5],
    };

    const getPlayerKey = (obj) => {
        if (!obj) return null;
        if (obj[playerToMove] !== undefined) return playerToMove;
        const sk = String(playerToMove);
        if (obj[sk] !== undefined) return sk;
        return null;
    };

    const cloneStateBase = () => {
        const next = { ...state };
        if (state?.playerStats) {
            next.playerStats = { ...state.playerStats };
            const statsKey = getPlayerKey(state.playerStats);
            if (statsKey !== null) next.playerStats[statsKey] = { ...state.playerStats[statsKey] };
        }
        if (state?.playerResources) {
            next.playerResources = { ...state.playerResources };
            const resKey = getPlayerKey(state.playerResources);
            if (resKey !== null) {
                const v = state.playerResources[resKey];
                next.playerResources[resKey] = Array.isArray(v) ? v.slice() : { ...v };
            }
        }
        if (state?.playerDevCards) {
            next.playerDevCards = { ...state.playerDevCards };
            const devKey = getPlayerKey(state.playerDevCards);
            if (devKey !== null) {
                const v = state.playerDevCards[devKey];
                next.playerDevCards[devKey] = Array.isArray(v) ? v.slice() : v;
            }
        }
        return next;
    };

    const canAffordAndDeduct = (nextState, costIds) => {
        const resKey = getPlayerKey(nextState.playerResources);
        if (resKey === null) return false;
        const hand = nextState.playerResources?.[resKey];

        // Array form: [1,1,3,5,...]
        if (Array.isArray(hand)) {
            const tmp = hand.slice();
            for (const id of costIds) {
                const idx = tmp.indexOf(id);
                if (idx === -1) return false;
                tmp.splice(idx, 1);
            }
            nextState.playerResources[resKey] = tmp;
            return true;
        }

        // Count-map form: { wood: n, brick: n, sheep: n, wheat: n, ore: n }
        if (hand && typeof hand === "object") {
            const nameById = { 1: "wood", 2: "brick", 3: "sheep", 4: "wheat", 5: "ore" };
            const tmp = { ...hand };
            for (const id of costIds) {
                const k = nameById[id];
                if (!k) return false;
                const n = Number(tmp[k] ?? 0);
                if (!Number.isFinite(n) || n <= 0) return false;
                tmp[k] = n - 1;
            }
            nextState.playerResources[resKey] = tmp;
            return true;
        }

        return false;
    };

    const bumpVp = (nextState, delta) => {
        const stats =
            nextState.playerStats?.[playerToMove] ??
            nextState.playerStats?.[String(playerToMove)] ??
            null;
        if (stats && typeof stats.vp === "number") {
            stats.vp += delta;
        }
    };

    let bestMove = null;
    let bestScore = -Infinity;

    // Candidate 1: build settlement on any unoccupied corner in mapState.
    for (const [cornerKey, baseCorner] of cornerEntries) {
        const occ = baseSettlements[cornerKey];
        if (occ?.owner) continue;
        if (!canPlaceSettlementAt(cornerKey)) continue;

        const spot = {
            x: occ?.x ?? baseCorner.x,
            y: occ?.y ?? baseCorner.y,
            z: occ?.z ?? baseCorner.z,
        };

        const nextState = cloneStateBase();
        if (!canAffordAndDeduct(nextState, COST.settlement)) continue;
        nextState.settlements = { ...baseSettlements };
        nextState.settlements[cornerKey] = { ...spot, owner: pid, buildingType: 1 };
        bumpVp(nextState, 1);

        const score = calculate_heuristric(nextState, pid, weights);
        if (score > bestScore) {
            bestScore = score;
            bestMove = { type: "build_settlement", key: cornerKey, corner: spot, score };
        }
    }

    // Candidate 2: upgrade any owned settlement to a city.
    for (const [cornerKey, piece] of Object.entries(baseSettlements)) {
        if (!piece?.owner || Number(piece.owner) !== pid) continue;
        if (piece.buildingType !== 1) continue;

        const nextState = cloneStateBase();
        if (!canAffordAndDeduct(nextState, COST.city)) continue;
        nextState.settlements = { ...baseSettlements };
        nextState.settlements[cornerKey] = { ...piece, buildingType: 2 };
        bumpVp(nextState, 1);

        const score = calculate_heuristric(nextState, pid, weights);
        if (score > bestScore) {
            bestScore = score;
            bestMove = { type: "upgrade_city", key: cornerKey, corner: { x: piece.x, y: piece.y, z: piece.z }, score };
        }
    }

    // Candidate 3: place a road on any unoccupied edge in mapState.
    for (const [edgeKey, baseEdge] of edgeEntries) {
        const occ = baseRoads[edgeKey];
        if (occ?.owner) continue;
        if (!roadConnectsToNetwork(edgeKey)) continue;

        const nextState = cloneStateBase();
        if (!canAffordAndDeduct(nextState, COST.road)) continue;

        nextState.roads = { ...baseRoads };
        nextState.roads[edgeKey] = {
            ...(occ ?? baseEdge),
            x: (occ?.x ?? baseEdge.x),
            y: (occ?.y ?? baseEdge.y),
            z: (occ?.z ?? baseEdge.z),
            owner: pid,
            type: 1,
        };

        const score = calculate_heuristric(nextState, pid, weights);
        if (score > bestScore) {
            bestScore = score;
            bestMove = { type: "build_road", key: edgeKey, edge: { x: baseEdge.x, y: baseEdge.y, z: baseEdge.z }, score };
        }
    }

    // Candidate 4: buy a development card (deduct resources only).
    {
        const nextState = cloneStateBase();
        if (canAffordAndDeduct(nextState, COST.devCard)) {
            const devKey = getPlayerKey(nextState.playerDevCards);
            if (devKey !== null) {
                const arr = nextState.playerDevCards?.[devKey];
                if (Array.isArray(arr)) {
                    // Unknown actual card type at simulation time; keep as 0 placeholder.
                    nextState.playerDevCards[devKey] = arr.concat([0]);
                }
            }
            const score = calculate_heuristric(nextState, pid, weights);
            if (score > bestScore) {
                bestScore = score;
                bestMove = { type: "buy_dev_card", key: null, score };
            }
        }
    }

    return bestMove;
}

/**
 * CATAN BOARD VISUALIZATION  —  Colonist.io data
 *
 * ── COORDINATE SYSTEM ──────────────────────────────────────────────────────
 *
 * tileHexStates { x, y, type, diceNumber }
 *   Axial coordinates, flat-top hex orientation.
 *   (0,0) = center hex. x increases right-downward, y increases downward.
 *
 * tileCornerStates { x, y, z }
 *   Each vertex is shared by up to 3 hexes. The canonical reference is one
 *   adjacent hex (x, y) and z ∈ {0, 1}:
 *     z=0  North vertex  (top point of hex, 270° / straight up)
 *     z=1  South vertex  (bottom point of hex, 90° / straight down)
 *   Every vertex on the board is either the North or South vertex of at
 *   least one hex in tileHexStates.
 *
 * tileEdgeStates { x, y, z }
 *   Three edge orientations cover every edge without duplication.
 *   Reference hex (x, y) and z ∈ {0, 1, 2}:
 *     z=0  Upper-Right edge  (NE, ~330° midpoint)
 *     z=1  Right edge        (E,  ~30°  midpoint)  ← "east" in SVG-y-down
 *     z=2  Lower-Right edge  (SE, ~90°  midpoint)
 *   (Opposite edges of the board are covered by the adjacent sea tile.)
 *
 * portEdgeStates { x, y, z, type }
 *   (x, y)  =  the SEA tile the port belongs to (may be outside the 19-hex
 *               land board).
 *   z       =  which edge of that sea tile faces the land; same 0/1/2
 *               orientation as tileEdgeStates.
 *   The port icon should be placed at that edge midpoint and pushed
 *   INWARD (toward board center / land), NOT outward.
 *
 * Port types:  1=3:1  2=Wood2:1  3=Brick2:1  4=Sheep2:1  5=Wheat2:1  6=Ore2:1
 * Hex  types:  0=Desert 1=Wood 2=Brick 3=Sheep 4=Wheat 5=Ore
 */

const SIZE = 55;
const svg = document.getElementById("catanBoard");
const LABEL_MAX_DIST = 195; // px — hide EDGE labels beyond this (vertex labels always shown)
const PLAYER_COLOR_NAMES = { 1: "red", 2: "blue", 3: "orange", 4: "green", 5: "black", 6: "bronze", 7: "silver", 8: "yellow", 9: "white", 10: "purple", 11: "mysticblue", 12: "pink" };
const RESOURCE_TYPES = ["wood", "brick", "sheep", "wheat", "ore"];
const DEV_CARD_TYPES = ["knight", "victoryPoint", "roadBuilding", "yearOfPlenty", "monopoly"];
const RESOURCE_IMAGES = {
  wood: "./data/images/card_lumber.svg",
  brick: "./data/images/card_brick.svg",
  sheep: "./data/images/card_wool.svg",
  wheat: "./data/images/card_grain.svg",
  ore: "./data/images/card_ore.svg"
};
const DEV_CARD_BACK_IMAGE = "./data/images/card_devcardback.svg";
const DEV_CARD_IMAGES = {
  knight: "./data/images/card_knight.svg",
  victoryPoint: "./data/images/card_vp.svg",
  roadBuilding: "./data/images/card_roadbuilding.svg",
  yearOfPlenty: "./data/images/card_yearofplenty.svg",
  monopoly: "./data/images/card_monopoly.svg"
};
const DEV_CARD_CODE_TO_TYPE = {
  11: 'knight',
  10: 'victoryPoint',
  12: 'victoryPoint',
  13: 'monopoly',
  14: 'roadBuilding',
  15: 'yearOfPlenty'
};
const DEV_CARD_LABELS = {
  knight: 'Knight',
  victoryPoint: 'Victory Point',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly'
};
const getBuildingImagePath = (type, playerId) => {
  const colorName = PLAYER_COLOR_NAMES[playerId];
  return colorName ? `./data/images/${type}_${colorName}.svg` : "";
};
const getNewCodes = (before = [], after = []) => {
  const counts = {};
  before.forEach(code => counts[code] = (counts[code] || 0) + 1);
  const added = [];
  after.forEach(code => {
    if (counts[code]) {
      counts[code] -= 1;
    } else {
      added.push(code);
    }
  });
  return added;
};

// ── ENUMS ───────────────────────────────────────────────────────────────────
const HEX_TYPES = { 0: "Desert", 1: "Wood", 2: "Brick", 3: "Sheep", 4: "Wheat", 5: "Ore" };
const PORT_TYPES = {
  1: { label: "3:1", name: "3:1 Port" },
  2: { label: "2:1", name: "Wood 2:1" },
  3: { label: "2:1", name: "Brick 2:1" },
  4: { label: "2:1", name: "Sheep 2:1" },
  5: { label: "2:1", name: "Wheat 2:1" },
  6: { label: "2:1", name: "Ore 2:1" },
};

const playgroundState = {
  players: [],
  turnOrder: [],
  currentTurnIndex: 0,
  rollHistory: [],
  turnOrderConfirmed: false,
  lastRollerPlayerId: null,
};

// Analytics mode state
let currentGameData = null;
let turnStates = [];
let currentTurnIndex = 0;

// ── TURN PARSING ────────────────────────────────────────────────────────────
function parseTurnsFromEvents(gameData) {
  const events = gameData?.data?.eventHistory?.events ?? [];
  const initialState = gameData?.data?.eventHistory?.initialState ?? {};
  const turns = [];
  const playOrder = gameData?.data?.playOrder || [];
  let longestRoadOwner = null;
  let maxRoadLength = 4; // Minimum 5 required
  let largestArmyOwner = null;
  let maxKnightsPlayed = 2; // Minimum 3 required

  // Initialize turn 0
  const turnZero = {
    turnNumber: 0,
    diceRoll: null,
    diceRolls: [],
    roads: {},
    settlements: {},
    cities: {},
    playerResources: {},
    playerDevCards: {},
    playerDevCardsUsed: {},
    playerStats: {},
    bankState: initialState.bankState?.resourceCards ? { ...initialState.bankState.resourceCards } : { 1: 19, 2: 19, 3: 19, 4: 19, 5: 19 },
    bankDevCards: initialState.mechanicDevelopmentCardsState?.bankDevelopmentCards?.cards ? [...initialState.mechanicDevelopmentCardsState.bankDevelopmentCards.cards] : [],
    robberIndex: initialState.mechanicRobberState?.locationTileIndex ?? -1,
    activePlayer: null
  };

  for (const playerId of playOrder) {
    turnZero.playerStats[playerId] = {
      citiesBuilt: 0, settlementsBuilt: 0, roadsBuilt: 0,
      longestRoad: 0, knightsPlayed: 0, vp: 0
    };
  }
  turns.push(turnZero);

  let activeOffers = {}; // Track across events
  // Initialize with the starting state
  let currentTurn = {
    turnNumber: 0,
    diceRoll: null,
    diceRolls: [],
    roads: {},
    settlements: {},
    cities: {},
    playerResources: {},
    playerDevCards: {},
    playerDevCardsUsed: {},
    playerStats: {},
    bankState: initialState.bankState?.resourceCards ? { ...initialState.bankState.resourceCards } : { 1: 19, 2: 19, 3: 19, 4: 19, 5: 19 },
    bankDevCards: initialState.mechanicDevelopmentCardsState?.bankDevelopmentCards?.cards ? [...initialState.mechanicDevelopmentCardsState.bankDevelopmentCards.cards] : [],
    robberIndex: initialState.mechanicRobberState?.locationTileIndex ?? -1,
    eventLogs: [],
    activePlayer: null
  };

  if (currentTurn.robberIndex === -1 && initialState.mapState?.tileHexStates) {
    const desertHex = Object.entries(initialState.mapState.tileHexStates).find(([idx, hex]) => hex.type === 0);
    if (desertHex) currentTurn.robberIndex = parseInt(desertHex[0]);
  }

  for (const playerId of playOrder) {
    currentTurn.playerStats[playerId] = {
      citiesBuilt: 0, settlementsBuilt: 0, roadsBuilt: 0,
      longestRoad: 0, knightsPlayed: 0, vp: 0
    };
  }

  // Copy initial map state
  if (initialState.mapState) {
    if (initialState.mapState.tileEdgeStates) {
      currentTurn.roads = JSON.parse(JSON.stringify(initialState.mapState.tileEdgeStates));
    }
    if (initialState.mapState.tileCornerStates) {
      currentTurn.settlements = JSON.parse(JSON.stringify(initialState.mapState.tileCornerStates));
    }
  }

  turns.push(currentTurn);

  // Process events
  for (const event of events) {
    const stateChange = event?.stateChange ?? {};

    const prevPlayerStats = JSON.parse(JSON.stringify(currentTurn.playerStats || {}));
    const prevPlayerDevCards = JSON.parse(JSON.stringify(currentTurn.playerDevCards || {}));
    const prevPlayerDevCardsUsed = JSON.parse(JSON.stringify(currentTurn.playerDevCardsUsed || {}));

    // Bank and Robber State
    if (stateChange.bankState?.resourceCards) {
      Object.assign(currentTurn.bankState, stateChange.bankState.resourceCards);
    }
    if (stateChange.mechanicDevelopmentCardsState?.bankDevelopmentCards?.cards) {
      currentTurn.bankDevCards = [...stateChange.mechanicDevelopmentCardsState.bankDevelopmentCards.cards];
    }
    if (stateChange.mechanicRobberState?.locationTileIndex !== undefined) {
      currentTurn.robberIndex = stateChange.mechanicRobberState.locationTileIndex;
    }

    // Process Logs
    if (stateChange.gameLogState) {
      const devCardPlayPending = {};
      for (const log of Object.values(stateChange.gameLogState)) {
        // Track dice rolls from log text
        if (log?.text?.type === 10 && log.text.firstDice !== undefined && log.text.secondDice !== undefined) {
          const roll = log.text.firstDice + log.text.secondDice;
          currentTurn.diceRolls.push({
            value: roll,
            playerId: log.text.playerColor || log.from,
            turnNumber: currentTurn.turnNumber
          });
          currentTurn.diceRoll = roll;
          currentTurn.eventLogs.push({ type: 'dice', player: log.text.playerColor || log.from, value: roll });
        }

        // Development card played (Type 20)
        if (log?.text?.type === 20 && log.text.cardEnum !== undefined) {
          const cardType = DEV_CARD_CODE_TO_TYPE[log.text.cardEnum];
          const playerId = log.text.playerColor || log.from;
          const event = { type: 'devCardPlayed', player: playerId, cardType, resources: [], stolenResource: undefined };
          currentTurn.eventLogs.push(event);
          if (cardType) {
            if (!devCardPlayPending[playerId]) devCardPlayPending[playerId] = [];
            devCardPlayPending[playerId].push({ cardType, eventIndex: currentTurn.eventLogs.length - 1 });
          }
        }

        // Year of Plenty picks resources from the bank (Type 21)
        if (log?.text?.type === 21 && Array.isArray(log.text.cardEnums)) {
          const playerId = log.text.playerColor || log.from;
          const pending = (devCardPlayPending[playerId] || []).slice().reverse().find(p => p.cardType === 'yearOfPlenty');
          if (pending) {
            currentTurn.eventLogs[pending.eventIndex].resources = [...log.text.cardEnums];
          }
        }

        // Monopoly steals a resource from everyone (Type 86)
        // The type 86 log contains amountStolen (total) and cardEnum (resource).
        // Per-victim counts are derived by diffing each opponent's resourceCards in
        // the same event's playerStates — no type 14 logs are emitted for monopoly.
        if (log?.text?.type === 86 && log.text.cardEnum !== undefined) {
          const playerId = log.text.playerColor || log.from;
          const pending = (devCardPlayPending[playerId] || []).slice().reverse().find(p => p.cardType === 'monopoly');
          if (pending) {
            const monopolyLogEntry = currentTurn.eventLogs[pending.eventIndex];
            monopolyLogEntry.stolenResource = log.text.cardEnum;
            monopolyLogEntry.amountStolen = log.text.amountStolen ?? 0;

            // Build per-victim breakdown by comparing each opponent's hand in
            // this event's playerStates against the last known hand.
            const resource = log.text.cardEnum;
            const stealsByVictim = {};
            const newPlayerStates = stateChange.playerStates || {};
            for (const [pIdStr, pState] of Object.entries(newPlayerStates)) {
              const pId = Number(pIdStr);
              if (pId === playerId) continue; // skip the monopoly player themselves
              if (!pState.resourceCards?.cards) continue;
              const afterCards = pState.resourceCards.cards;
              const beforeCards = currentTurn.playerResources[pIdStr] || currentTurn.playerResources[pId] || [];
              const beforeCount = beforeCards.filter(c => c === resource).length;
              const afterCount = afterCards.filter(c => c === resource).length;
              const stolen = beforeCount - afterCount;
              if (stolen > 0) {
                stealsByVictim[pId] = stolen;
              }
            }
            if (Object.keys(stealsByVictim).length > 0) {
              monopolyLogEntry.stealsByVictim = stealsByVictim;
            }
          }
        }

        // Resources Gained (Type 47)
        if (log?.text?.type === 47 && log.text.cardsToBroadcast) {
          currentTurn.eventLogs.push({
            type: 'gain',
            player: log.text.playerColor || log.from,
            resources: log.text.cardsToBroadcast
          });
        }

        // Discarded (Type 55)
        if (log?.text?.type === 55 && log.text.cardEnums) {
          currentTurn.eventLogs.push({
            type: 'discard',
            player: log.text.playerColor || log.from,
            resources: log.text.cardEnums
          });
        }

        // Robber Moved (Type 11)
        if (log?.text?.type === 11) {
          currentTurn.eventLogs.push({
            type: 'robberMoved',
            player: log.text.playerColor || log.from,
            hexIndex: currentTurn.robberIndex
          });
        }

        // Steal detail (Type 14) — only for regular knight/robber steals, not monopoly
        if (log?.text?.type === 14 && log.text.cardEnums) {
          currentTurn.eventLogs.push({
            type: 'stealDetail',
            player: log.from,
            victim: log.text.playerColor,
            resources: log.text.cardEnums
          });
        }

        // Bank Trade (Type 116)
        if (log?.text?.type === 116) {
          currentTurn.eventLogs.push({
            type: 'bankTrade',
            player: log.text.playerColor || log.from,
            given: log.text.givenCardEnums,
            received: log.text.receivedCardEnums
          });
        }

        // Trade Accepted (Type 115)
        if (log?.text?.type === 115) {
          currentTurn.eventLogs.push({
            type: 'tradeAccepted',
            proposer: log.text.playerColor || log.from,
            accepter: log.text.acceptingPlayerColor,
            offered: log.text.givenCardEnums,
            received: log.text.receivedCardEnums
          });
        }
      }
    }

    // Trade State Parsing (Proposed and Responses)
    if (stateChange.tradeState?.activeOffers) {
      for (const [offerId, offerUpdate] of Object.entries(stateChange.tradeState.activeOffers)) {
        if (offerUpdate === null) {
          delete activeOffers[offerId];
          continue;
        }

        if (!activeOffers[offerId]) {
          activeOffers[offerId] = { id: offerId, responses: {} };
        }

        const offer = activeOffers[offerId];
        if (offerUpdate.creator) offer.creator = offerUpdate.creator;
        if (offerUpdate.wantedResources) offer.wantedResources = offerUpdate.wantedResources;
        if (offerUpdate.offeredResources) offer.offeredResources = offerUpdate.offeredResources;

        // New offer proposed log
        if (offerUpdate.creator && offerUpdate.wantedResources && offerUpdate.offeredResources) {
          currentTurn.eventLogs.push({
            type: 'tradeProposed',
            player: offer.creator,
            wanted: offer.wantedResources,
            offered: offer.offeredResources,
            id: offerId
          });
        }

        // Responses
        if (offerUpdate.playerResponses) {
          for (const [pId, response] of Object.entries(offerUpdate.playerResponses)) {
            if (offer.responses[pId] === response) continue;
            offer.responses[pId] = response;

            if (response === 1) {
              currentTurn.eventLogs.push({
                type: 'tradeResponse',
                player: parseInt(pId),
                status: 'accepted',
                originalId: offerId,
                creator: offer.creator,
                wanted: offer.wantedResources,
                offered: offer.offeredResources
              });
            } else if (response === 2) {
              currentTurn.eventLogs.push({
                type: 'tradeResponse',
                player: parseInt(pId),
                status: 'rejected',
                originalId: offerId
              });
            }
          }
        }
      }
    }

    // Fallback tracking from diceState just in case
    if (!stateChange.gameLogState && (stateChange.diceState?.dice1 !== undefined || stateChange.diceState?.dice2 !== undefined)) {
      const dice1 = stateChange.diceState?.dice1;
      const dice2 = stateChange.diceState?.dice2;
      if (dice1 && dice2) {
        const roll = dice1 + dice2;
        currentTurn.diceRolls.push({
          value: roll,
          playerId: currentTurn.activePlayer,
          turnNumber: currentTurn.turnNumber
        });
        currentTurn.diceRoll = roll;
        currentTurn.eventLogs.push({ type: 'dice', player: currentTurn.activePlayer, value: roll });
      }
    }

    // Track current player
    if (stateChange.currentState?.currentTurnPlayerColor) {
      currentTurn.activePlayer = stateChange.currentState.currentTurnPlayerColor;
    }

    // Track building placements (roads) with deep merge
    if (stateChange.mapState?.tileEdgeStates) {
      for (const [key, value] of Object.entries(stateChange.mapState.tileEdgeStates)) {
        if (currentTurn.roads[key]) {
          Object.assign(currentTurn.roads[key], value);
        } else {
          currentTurn.roads[key] = { ...value };
        }
      }
    }

    // Track settlements and cities with deep merge
    if (stateChange.mapState?.tileCornerStates) {
      for (const [key, value] of Object.entries(stateChange.mapState.tileCornerStates)) {
        if (currentTurn.settlements[key]) {
          Object.assign(currentTurn.settlements[key], value);
        } else {
          currentTurn.settlements[key] = { ...value };
        }
      }
    }

    if (stateChange.mechanicCityState) {
      for (const [pId, state] of Object.entries(stateChange.mechanicCityState)) {
        if (state.bankCityAmount !== undefined && currentTurn.playerStats[pId]) {
          currentTurn.playerStats[pId].citiesBuilt = 4 - state.bankCityAmount;
        }
      }
    }
    if (stateChange.mechanicSettlementState) {
      for (const [pId, state] of Object.entries(stateChange.mechanicSettlementState)) {
        if (state.bankSettlementAmount !== undefined && currentTurn.playerStats[pId]) {
          currentTurn.playerStats[pId].settlementsBuilt = 5 - state.bankSettlementAmount;
        }
      }
    }
    if (stateChange.mechanicRoadState) {
      for (const [pId, state] of Object.entries(stateChange.mechanicRoadState)) {
        if (state.bankRoadAmount !== undefined && currentTurn.playerStats[pId]) {
          currentTurn.playerStats[pId].roadsBuilt = 15 - state.bankRoadAmount;
        }
      }
    }
    if (stateChange.mechanicLongestRoadState) {
      for (const [pId, state] of Object.entries(stateChange.mechanicLongestRoadState)) {
        if (state.longestRoad !== undefined && currentTurn.playerStats[pId]) {
          currentTurn.playerStats[pId].longestRoad = state.longestRoad;
        }
      }
    }
    if (stateChange.playerStates) {
      for (const [pId, state] of Object.entries(stateChange.playerStates)) {
        if (state.victoryPointsState && currentTurn.playerStats[pId]) {
          // 1. TRUST THE ENGINE: Sum all point types (Public, Awards, and VP Cards)
          const totalVp = Object.values(state.victoryPointsState)
            .reduce((sum, val) => sum + (typeof val === 'number' ? val : 0), 0);

          currentTurn.playerStats[pId].vp = totalVp;
        }

        if (state.resourceCards?.cards) {
          currentTurn.playerResources[pId] = state.resourceCards.cards;
        }
      }
    }
    if (stateChange.mechanicDevelopmentCardsState?.players) {
      for (const [pId, state] of Object.entries(stateChange.mechanicDevelopmentCardsState.players)) {
        if (state.developmentCards?.cards) {
          currentTurn.playerDevCards[pId] = state.developmentCards.cards;
        }
        if (state.developmentCardsUsed && currentTurn.playerStats[pId]) {
          currentTurn.playerStats[pId].knightsPlayed = state.developmentCardsUsed.filter(c => c === 11).length;
          currentTurn.playerDevCardsUsed[pId] = [...state.developmentCardsUsed];
        }
      }
    }

    // Update Longest Road Tracking
    if (stateChange.mechanicLongestRoadState) {
      for (const [pId, state] of Object.entries(stateChange.mechanicLongestRoadState)) {
        if (state.longestRoad > maxRoadLength) {
          maxRoadLength = state.longestRoad;
          longestRoadOwner = Number(pId);
        }
      }
    }

    // Update Largest Army Tracking
    if (stateChange.mechanicDevelopmentCardsState?.players) {
      for (const [pId, state] of Object.entries(stateChange.mechanicDevelopmentCardsState.players)) {
        if (state.developmentCardsUsed) {
          const knights = state.developmentCardsUsed.filter(c => c === 11).length;
          if (knights > maxKnightsPlayed) {
            maxKnightsPlayed = knights;
            largestArmyOwner = Number(pId);
          }
        }
      }
    }

    // Calculate total VP for each player (inside the event loop)
    for (const pId of playOrder) {
      const stats = currentTurn.playerStats[pId];
      const devCards = currentTurn.playerDevCards[pId] || [];

      // 1. Settlements (1 VP each) + Cities (2 VP each)
      let calculatedVp = (stats.settlementsBuilt * 1) + (stats.citiesBuilt * 2);

      // 2. Add 2 VP for Longest Road (This matches your missing +2 for Blue/Red)
      if (pId === longestRoadOwner) {
        calculatedVp += 2;
      }

      // 3. Add 2 VP for Largest Army
      if (pId === largestArmyOwner) {
        calculatedVp += 2;
      }

      // 4. Add 1 VP for every Victory Point card
      const vpCardCount = devCards.filter(cardType => cardType === 10 || cardType === 12).length;
      calculatedVp += vpCardCount;

      // CRITICAL FIX: Explicitly update the turn state so the UI sees it
      currentTurn.playerStats[pId].vp = calculatedVp;
    }

    const changedPlayerIds = new Set([
      ...Object.keys(currentTurn.playerStats || {}),
      ...Object.keys(prevPlayerStats || {}),
      ...Object.keys(prevPlayerDevCards || {}),
      ...Object.keys(prevPlayerDevCardsUsed || {})
    ]);

    for (const pId of changedPlayerIds) {
      const oldStats = prevPlayerStats[pId] || { roadsBuilt: 0, settlementsBuilt: 0, citiesBuilt: 0 };
      const newStats = currentTurn.playerStats[pId] || { roadsBuilt: 0, settlementsBuilt: 0, citiesBuilt: 0 };

      const newRoads = (newStats.roadsBuilt || 0) - (oldStats.roadsBuilt || 0);
      const newSettlements = (newStats.settlementsBuilt || 0) - (oldStats.settlementsBuilt || 0);
      const newCities = (newStats.citiesBuilt || 0) - (oldStats.citiesBuilt || 0);

      if (newRoads > 0) {
        currentTurn.eventLogs.push({ type: 'buildingPurchased', player: Number(pId), building: 'road', count: newRoads });
      }
      if (newSettlements > 0) {
        currentTurn.eventLogs.push({ type: 'buildingPurchased', player: Number(pId), building: 'settlement', count: newSettlements });
      }
      if (newCities > 0) {
        currentTurn.eventLogs.push({ type: 'buildingPurchased', player: Number(pId), building: 'city', count: newCities });
      }

      const oldDevCards = prevPlayerDevCards[pId] || [];
      const newDevCards = currentTurn.playerDevCards[pId] || [];
      if (newDevCards.length > oldDevCards.length) {
        currentTurn.eventLogs.push({ type: 'devCardBought', player: Number(pId), count: newDevCards.length - oldDevCards.length });
      }

      const oldUsed = prevPlayerDevCardsUsed[pId] || [];
      const newUsed = currentTurn.playerDevCardsUsed[pId] || [];
      const addedUsedCodes = getNewCodes(oldUsed, newUsed);
      addedUsedCodes.forEach(code => {
        const cardType = DEV_CARD_CODE_TO_TYPE[code];
        if (cardType) {
          // Check if this card was already logged from type 20
          const alreadyLogged = currentTurn.eventLogs.some(logItem =>
            logItem.type === 'devCardPlayed' &&
            logItem.player === Number(pId) &&
            logItem.cardType === cardType
          );

          if (!alreadyLogged) {
            currentTurn.eventLogs.push({ type: 'devCardPlayed', player: Number(pId), cardType });
          }
        }
      });
    }

    // Check if turn is complete
    if (stateChange.currentState?.completedTurns !== undefined &&
      stateChange.currentState.completedTurns > currentTurn.turnNumber) {
      // Start a new turn
      currentTurn = {
        turnNumber: stateChange.currentState.completedTurns,
        diceRoll: null,
        diceRolls: [],
        roads: JSON.parse(JSON.stringify(currentTurn.roads)),
        settlements: JSON.parse(JSON.stringify(currentTurn.settlements)),
        cities: JSON.parse(JSON.stringify(currentTurn.cities)),
        playerResources: JSON.parse(JSON.stringify(currentTurn.playerResources)),
        playerDevCards: JSON.parse(JSON.stringify(currentTurn.playerDevCards)),
        playerDevCardsUsed: JSON.parse(JSON.stringify(currentTurn.playerDevCardsUsed)),
        playerStats: JSON.parse(JSON.stringify(currentTurn.playerStats)),
        bankState: JSON.parse(JSON.stringify(currentTurn.bankState)),
        bankDevCards: [...currentTurn.bankDevCards],
        robberIndex: currentTurn.robberIndex,
        eventLogs: [],
        activePlayer: stateChange.currentState.currentTurnPlayerColor || currentTurn.activePlayer
      };
      turns.push(currentTurn);
    }
  }

  return turns;
}

function updateAnalyticsView(turnIndex) {
  if (!currentGameData || !turnStates || turnIndex >= turnStates.length) return;

  currentTurnIndex = turnIndex;
  const turn = turnStates[turnIndex];
  const initialState = currentGameData?.data?.eventHistory?.initialState ?? {};
  const mapState = initialState.mapState ?? {};

  // Update turn info
  const turnInfo = document.getElementById("turnInfo");
  if (turnInfo) {
    turnInfo.textContent = `Turn ${turnIndex} / ${turnStates.length - 1}`;
  }

  // Clear and redraw board
  svg.innerHTML = "";

  const hexes = mapState.tileHexStates ? Object.values(mapState.tileHexStates) : [];
  const ports = mapState.portEdgeStates ? Object.values(mapState.portEdgeStates) : [];
  const edges = mapState.tileEdgeStates ? Object.values(mapState.tileEdgeStates) : [];
  const corners = mapState.tileCornerStates ? Object.values(mapState.tileCornerStates) : [];

  // Draw in layers
  _currentTooltipTurn = turn;
  _currentTooltipMapState = mapState;

  const tileHexEntries = mapState.tileHexStates ? Object.entries(mapState.tileHexStates) : [];
  tileHexEntries.forEach(([idx, tile]) => renderHexPolygon(tile, parseInt(idx)));
  ports.forEach(renderPort);
  edges.forEach(renderEdge);
  corners.forEach(renderVertex);
  tileHexEntries.forEach(([, tile]) => renderHexLabels(tile));

  // Render roads from current turn state
  Object.values(turn.roads).forEach(road => {
    if (road.type === 1 && road.owner) renderRoadPiece(road);
  });

  // Render settlements/cities from current turn state
  Object.values(turn.settlements).forEach(piece => {
    if (piece.owner) {
      if (piece.buildingType === 2) {
        renderCityPiece(piece);
      } else if (piece.buildingType === 1) {
        renderSettlementPiece(piece);
      }
    }
  });

  edges.forEach(renderEdgeLabel);
  corners.forEach(renderVertexLabel);

  // Update dice rolls display
  updateDiceRollsDisplay(turn);

  // Render Robber
  if (turn.robberIndex !== -1) {
    renderRobberPiece(turn.robberIndex, mapState.tileHexStates[turn.robberIndex]);
  }

  // Update bank state display
  updateBankStateDisplay(turn);

  // Update event log display
  updateEventLogDisplay(turnIndex);

  // Update player tracker for analytics
  updateAnalyticsPlayerTracker(turn);
}

function updateDiceRollsDisplay(turn) {
  const rollSummary = document.getElementById("analyticsRollHistory");
  if (!rollSummary) return;

  const allRolls = [];
  for (let i = 0; i <= currentTurnIndex; i++) {
    if (turnStates[i] && turnStates[i].diceRolls) {
      allRolls.push(...turnStates[i].diceRolls);
    }
  }

  if (allRolls.length === 0) {
    rollSummary.innerHTML = "<p style='color: #94a3b8; font-size: 12px;'>No rolls yet</p>";
    return;
  }

  const counts = allRolls.reduce((acc, rollObj) => {
    acc[rollObj.value] = (acc[rollObj.value] || 0) + 1;
    return acc;
  }, {});

  rollSummary.innerHTML = `
    <div style="font-size: 12px;">
      <strong>Summary:</strong> ${Object.entries(counts).sort((a, b) => a[0] - b[0]).map(([roll, count]) => `<span>${roll}:${count}</span>`).join(" | ")}
    </div>
  `;
}

function updateAnalyticsPlayerTracker(turn) {
  const tracker = document.getElementById("analyticsPlayerTracker");
  if (!tracker) return;

  if (!currentGameData?.data?.playerUserStates) {
    tracker.innerHTML = "<p style='color: #94a3b8; font-size: 12px;'>No player data</p>";
    return;
  }

  const players = currentGameData.data.playerUserStates;
  const playOrder = currentGameData.data.playOrder || [];

  tracker.innerHTML = playOrder.map((playerId, index) => {
    // MAINTAIN LOGIC: playerNum is always 1, 2, 3, 4 based on array position
    const playerNum = index + 1;

    // UPDATE: Map colorName directly from your new PLAYER_COLOR_NAMES using the data's ID
    const colorName = PLAYER_COLOR_NAMES[playerId] || "white";
    const playerIcon = `./data/images/player_bg_${colorName}.svg`;
    const settlementImage = colorName ? `./data/images/settlement_${colorName}.svg` : "";
    const roadImage = colorName ? `./data/images/road_${colorName}.svg` : "";
    const cityImage = colorName ? `./data/images/city_${colorName}.svg` : "";

    // Data lookup remains tied to the original playerId
    const stats = turn.playerStats?.[playerId] || { citiesBuilt: 0, settlementsBuilt: 0, roadsBuilt: 0, vp: 0, longestRoad: 0, knightsPlayed: 0 };
    const resources = turn.playerResources?.[playerId] || [];
    const devCards = turn.playerDevCards?.[playerId] || [];

    const playerRoads = stats.roadsBuilt;
    const playerSettlements = stats.settlementsBuilt;
    const playerCities = stats.citiesBuilt;

    // Resource and Dev Card maps remain the same
    const resCounts = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    const resMap = { 1: 'wood', 2: 'brick', 3: 'sheep', 4: 'wheat', 5: 'ore' };
    resources.forEach(r => { if (resMap[r]) resCounts[resMap[r]]++; });

    const devCounts = { knight: 0, victoryPoint: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 };
    const devMap = { 11: 'knight', 10: 'victoryPoint', 12: 'victoryPoint', 13: 'monopoly', 14: 'roadBuilding', 15: 'yearOfPlenty' };
    devCards.forEach(d => { if (devMap[d]) devCounts[devMap[d]]++; });

    // ... (rest of your HTML generation remains the same)
    const resourcesHtml = RESOURCE_TYPES.map(type => {
      const count = resCounts[type];
      const imagePath = RESOURCE_IMAGES[type];
      const label = { wood: "Wood", brick: "Brick", sheep: "Sheep", wheat: "Wheat", ore: "Ore" }[type];
      return `
          <div class="resource-item" style="display: inline-flex; align-items: center; gap: 4px; margin-right: 8px;">
            <img src="${imagePath}" alt="${type}" title="${label}" style="width: 16px; height: 16px;">
            <span>${count}</span>
          </div>
        `;
    }).join("");

    const devCardsHtml = DEV_CARD_TYPES.map(type => {
      const count = devCounts[type];
      const imagePath = DEV_CARD_IMAGES[type];
      const label = { knight: "Knight", victoryPoint: "Victory Point", roadBuilding: "Road Building", yearOfPlenty: "Year of Plenty", monopoly: "Monopoly" }[type];
      return `
          <div class="resource-item" style="display: inline-flex; align-items: center; gap: 4px; margin-right: 8px;">
            <img src="${imagePath}" alt="${type}" title="${label}" style="width: 16px; height: 16px;">
            <span>${count}</span>
          </div>
        `;
    }).join("");

    const isActive = turn.activePlayer === playerId ? " active-turn" : "";

    return `
      <div class="player-card${isActive}">
        <div class="player-header">
          ${playerIcon ? `<img src="${playerIcon}" alt="Player ${playerNum}" class="player-settlement-icon">` : ""}
          <h3>Player ${playerNum}</h3>
          <span style="margin-left: auto; font-weight: bold; color: gold;">${stats.vp} VP</span>
        </div>
        <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 4px;">
          <strong>Buildings:</strong> 
          <br>
          Roads: <b> ${playerRoads} </b> <img src=${roadImage} width="20" height="20" style="margin-right: 4px; vertical-align: middle;">
          <br>
          Settlements: <b> ${playerSettlements} </b> <img src=${settlementImage} width="20" height="20" style="margin-right: 4px; vertical-align: middle;">
          <br>
          Cities: <b> ${playerCities} </b> <img src=${cityImage} width="20" height="20" style="margin-right: 4px; vertical-align: middle;">
        </div>
        <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 4px;">
          <strong>Stats:</strong> 
          <br>
          Longest Road: <b> ${stats.longestRoad} </b> <img src=${`./data/images/icon_longest_road.svg`} width="20" height="20" style="margin-right: 4px; vertical-align: middle;">  
          <br>
          Knights Played: <b> ${stats.knightsPlayed} </b> <img src=${`./data/images/icon_largest_army.svg`} width="20" height="20" style="margin-right: 4px; vertical-align: middle;"> 
        </div>
        <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 4px;">
          <strong>Resources:</strong><br>
          ${resourcesHtml}
        </div>
        <div style="font-size: 11px; color: #cbd5e1;">
          <strong>Dev Cards:</strong> <br>
          ${devCardsHtml}
        </div>
      </div>
    `;
  }).join("");
}

// ── COORDINATE HELPERS ──────────────────────────────────────────────────────
function axialToPixel(x, y) {
  return { px: SIZE * 1.5 * x, py: -SIZE * Math.sqrt(3) * (y + x / 2) };
}

// Vertex index mapped to angle: North=270°, South=90°, plus remaining 4
// We use full 0-5 internally when computing hex polygons (60° steps from 0°).
// For corners: z=0 → vertex index 4 (240°→nearest to 270° top-left... 
// Actually with 60*i: v0=0°, v1=60°, v2=120°, v3=180°, v4=240°, v5=300°
// North = 270° is between v4(240°) and v5(300°) — no exact vertex.
// After testing: in pointy-hex drawn by 60°*i starting at 0°, the "top" is
// NOT a vertex. But the user confirmed z=0=North, z=1=South from actual labels.
// Map: z=0 → vertex 4 (upper-left-ish, 240°), z=1 → vertex 1 (lower-right, 60°)?
// Let's use the confirmed mapping from actual rendering labels seen in the screenshot:
// V(x,y,0) appears at TOP area, V(x,y,1) at BOTTOM area.
// 270° = top in screen (y decreasing). cos(270°)=0, sin(270°)=-1 → y decreases.
// With 60*i: sin(240°)=-√3/2 ≈ -0.866 (mostly up), sin(300°)=-√3/2 (mostly up)
// sin(90°)=1 (down). Vertex 1 (60°): sin(60°)=√3/2=0.866 (down).
// The topmost vertex by minimum py: vertex 4 (240°): sin=-0.866, vertex 5(300°): sin=-0.866
// → tie. The actual "top" of a flat-top hex is the EDGE at top, not a vertex.
// For pointy-top, vertex at 270° is the top point.
//
// Given the code uses angles 0°,60°,120°,... the two "upward" vertices are
// v4(240°, upper-left) and v5(300°, upper-right).
// z=0 → North: use vertex 5 (300°, upper-right side → visually top-right region)
//   OR v4 (upper-left region)
// The simplest match: z=0 → vertex 5 (330°-ish top), z=1 → vertex 2 (120°-ish bottom)
// Let's verify: v5=300°→ cos=-0.5,sin=-0.866 → upper area. v2=120°→upper-left.
//
// PRAGMATIC APPROACH: map z directly to vertex index as: cornerZToVertex[z]
// Test both and pick the one visually consistent with "z=0=North, z=1=South"
const CORNER_Z_TO_VERTEX = [5, 2]; // z=0→v5(300°=upper), z=1→v2(120°=lower-left)

// Edge z=0,1,2 → edge indices that produce upper-right, right, lower-right
// Edge i is between vertex i and (i+1)%6.
// Edge midpoint angles: 30°, 90°, 150°, 210°, 270°, 330°
// z=0 → edge 4 (midpoint 270° = straight up / N side)
// z=1 → edge 5 (midpoint 210° = upper-left / NW side)
// z=2 → edge 0 (midpoint 150° = lower-left / SW side)

const EDGE_Z_TO_IDX = [4, 3, 2];

function hexVertex(cx, cy, vIdx) {
  const a = (Math.PI / 180) * (60 * vIdx);
  // Keep local geometry aligned with mirrored x / inverted y world transform.
  return { x: cx + SIZE * Math.cos(a), y: cy - SIZE * Math.sin(a) };
}

// ── HEURISTIC GRID ─ attach map via state.mapState, or fallback to viewer currentGameData
function resolve_heuristic_map_state(state) {
  if (state?.mapState?.tileHexStates && state?.mapState?.tileCornerStates) {
    return state.mapState;
  }
  if (typeof currentGameData !== "undefined" && currentGameData?.data?.eventHistory?.initialState?.mapState) {
    return currentGameData.data.eventHistory.initialState.mapState;
  }
  return {};
}

function heuristic_corner_px(corner) {
  const p = axialToPixel(corner.x, corner.y);
  const vi = CORNER_Z_TO_VERTEX[corner.z] ?? CORNER_Z_TO_VERTEX[0];
  return hexVertex(p.px, p.py, vi);
}

function heuristic_touching_hexes(corner, hexes) {
  const pt = heuristic_corner_px(corner);
  const EPS = SIZE * 0.05 + 1e-9;
  const touching = [];
  for (const h of hexes) {
    const c = axialToPixel(h.x, h.y);
    for (let vi = 0; vi < 6; vi++) {
      const vtx = hexVertex(c.px, c.py, vi);
      if (Math.hypot(vtx.x - pt.x, vtx.y - pt.y) < EPS) {
        touching.push(h);
        break;
      }
    }
  }
  return touching;
}

function edgeMidByIdx(cx, cy, eIdx) {
  const v0 = hexVertex(cx, cy, eIdx);
  const v1 = hexVertex(cx, cy, (eIdx + 1) % 6);
  return { x: (v0.x + v1.x) / 2, y: (v0.y + v1.y) / 2 };
}
function dist2(x, y) { return x * x + y * y; }
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function svgText(attrs, text) {
  return Object.assign(svgEl("text", attrs), { textContent: String(text) });
}
function hexPolyPoints(cx, cy) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i);
    return `${cx + SIZE * Math.cos(a)},${cy - SIZE * Math.sin(a)}`;
  }).join(" ");
}

// ── RENDERERS ───────────────────────────────────────────────────────────────
// Render in LAYERS so dice tokens / labels are never hidden by adjacent hexes.
// Pass 1: all hex polygons
// Pass 2: all dice circles + labels + coord labels  
// Pass 3: ports
// Pass 4: edges
// Pass 5: vertices

// ── TOOLTIP ─────────────────────────────────────────────────────────────────
// A single floating <div> tooltip driven by D3-style pointer tracking.
// We avoid importing D3 just for this — the logic is simple enough to inline.

let _tooltipEl = null;
function getTooltip() {
  if (!_tooltipEl) {
    _tooltipEl = document.createElement("div");
    _tooltipEl.id = "catan-tooltip";
    Object.assign(_tooltipEl.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "9999",
      background: "rgba(15,23,42,0.97)",
      color: "#e2e8f0",
      border: "1px solid rgba(148,163,184,0.3)",
      borderRadius: "8px",
      padding: "10px 13px",
      fontSize: "12px",
      lineHeight: "1.6",
      maxWidth: "240px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      display: "none",
      transition: "opacity 0.1s",
    });
    document.body.appendChild(_tooltipEl);
  }
  return _tooltipEl;
}

function showTooltip(html, mouseEvent) {
  const tt = getTooltip();
  tt.innerHTML = html;
  tt.style.display = "block";
  positionTooltip(mouseEvent);
}

function positionTooltip(e) {
  const tt = getTooltip();
  if (tt.style.display === "none") return;
  const pad = 14;
  const tw = tt.offsetWidth;
  const th = tt.offsetHeight;
  let left = e.clientX + pad;
  let top = e.clientY + pad;
  if (left + tw > window.innerWidth - 8) left = e.clientX - tw - pad;
  if (top + th > window.innerHeight - 8) top = e.clientY - th - pad;
  tt.style.left = left + "px";
  tt.style.top = top + "px";
}

function hideTooltip() {
  const tt = getTooltip();
  tt.style.display = "none";
}

// ── TOOLTIP CONTENT BUILDERS ─────────────────────────────────────────────────

const HEX_TYPE_ICONS = {
  0: "🏜️", 1: "🪵", 2: "🧱", 3: "🐑", 4: "🌾", 5: "⛏️"
};
const RESOURCE_NAMES_BY_TYPE = {
  1: "Wood", 2: "Brick", 3: "Sheep", 4: "Wheat", 5: "Ore"
};
const PORT_RESOURCE_ICONS = {
  1: "🔀", 2: "🪵", 3: "🧱", 4: "🐑", 5: "🌾", 6: "⛏️"
};
const PORT_RESOURCE_NAMES = {
  1: "Any", 2: "Wood", 3: "Brick", 4: "Sheep", 5: "Wheat", 6: "Ore"
};

function buildPlayerAccessListHtml(ownerSet, playerNums, hasRobber) {
  const sorted = [...ownerSet].sort((a, b) => (playerNums[a] ?? 99) - (playerNums[b] ?? 99));
  if (sorted.length === 0) return "";

  return sorted.map(id => {
    const color = PLAYER_COLOR_NAMES[id] ?? "white";
    const imgPath = `./data/images/player_bg_${color}.svg`;

    // Container for relative positioning of the X
    let html = `<div style="position:relative; display:inline-flex; width:22px; height:22px; vertical-align:middle; margin-right:6px; margin-bottom: 2px;">`;
    html += `<img src="${imgPath}" style="width:22px; height:22px;" alt="${color} player icon" title="Player ${playerNums[id]} (${color})">`;

    if (hasRobber) {
      // Draw a red X over it
      html += `<svg viewBox="0 0 24 24" style="position:absolute; top:0; left:0; width:22px; height:22px; pointer-events:none;">
        <line x1="4" y1="4" x2="20" y2="20" stroke="#6e1616ff" stroke-width="4" stroke-linecap="round" />
        <line x1="20" y1="4" x2="4" y2="20" stroke="#6e1616ff" stroke-width="4" stroke-linecap="round" />
      </svg>`;
    }

    html += `</div>`;
    return html;
  }).join("");
}

function buildHexTooltipHtml(tile, tileIndex, turn, mapState) {
  const icon = HEX_TYPE_ICONS[tile.type] ?? "❓";
  const name = HEX_TYPES[tile.type] ?? "Unknown";
  const isDesert = tile.type === 0;
  const hasRobber = turn && turn.robberIndex === tileIndex;

  // Find which player corners/settlements border this hex.
  // A corner (x,y,z) is adjacent to hex (x,y) if its reference hex is (x,y).
  // Also corners from neighbouring hexes can border this hex — we use the
  // tileCornerStates from mapState (static geometry) and ownership from turn.settlements.
  const settlements = turn?.settlements ?? {};
  const ownerSet = new Set();

  // Corner adjacency: each hex has exactly 6 corners, but in the data they are
  // referenced by (x,y,z). The two corners with x==tile.x && y==tile.y are z=0 and z=1.
  // The other 4 are referenced by neighbouring hexes. We iterate ALL corners and
  // check pixel distance to the hex centre instead — simpler and robust.
  const { px: hcx, py: hcy } = axialToPixel(tile.x, tile.y);
  const threshold = SIZE * 1.05; // slightly more than SIZE to catch all 6 vertices

  for (const [, corner] of Object.entries(settlements)) {
    if (!corner.owner) continue;
    const { px: ccx, py: ccy } = axialToPixel(corner.x, corner.y);
    const vIdx = CORNER_Z_TO_VERTEX[corner.z] ?? corner.z;
    const vp = hexVertex(ccx, ccy, vIdx);
    const d = Math.hypot(vp.x - hcx, vp.y - hcy);
    if (d <= threshold) ownerSet.add(corner.owner);
  }

  const playOrder = currentGameData?.data?.playOrder || [];
  const playerNums = {};
  playOrder.forEach((id, i) => { playerNums[id] = i + 1; });

  let html = `<div style="font-weight:700;font-size:13px;margin-bottom:6px;">${icon} ${name} Hex</div>`;

  if (isDesert) {
    html += `<div style="color:#94a3b8;">No resources produced.</div>`;
  } else {
    const isHot = tile.diceNumber === 6 || tile.diceNumber === 8;
    const diceColor = isHot ? "#f87171" : "#e2e8f0";
    html += `<div>Roll: <span style="font-weight:700;color:${diceColor};">${tile.diceNumber}</span></div>`;
    html += `<div>Produces: <b>${RESOURCE_NAMES_BY_TYPE[tile.type] ?? name}</b></div>`;
  }

  if (hasRobber) {
    html += `<div style="margin-top:6px;padding:4px 7px;background:rgba(239,68,68,0.18);border-radius:5px;color:#fca5a5;">🚫 Robber is here — no resources produced${ownerSet.size > 0 ? " for affected players" : ""}.</div>`;
  }

  if (ownerSet.size > 0) {
    const playerList = buildPlayerAccessListHtml(ownerSet, playerNums, hasRobber);
    html += `<div style="margin-top:5px; display: flex; align-items: center;">Players: <span style="margin-left: 5px;">${playerList}</span></div>`;
  } else if (!isDesert) {
    html += `<div style="margin-top:5px;color:#94a3b8;">No players settled here yet.</div>`;
  }

  return html;
}

function buildPortTooltipHtml(port, turn, mapState) {
  const info = PORT_TYPES[port.type] ?? { label: "?", name: "Unknown" };
  const icon = PORT_RESOURCE_ICONS[port.type] ?? "❓";
  const resName = PORT_RESOURCE_NAMES[port.type] ?? "?";
  const is3to1 = port.type === 1;

  let html = `<div style="font-weight:700;font-size:13px;margin-bottom:6px;">${icon} ${info.name}</div>`;

  if (is3to1) {
    html += `<div>Trade <b>3</b> of any <em>identical</em> resource → <b>1</b> of any resource.</div>`;
  } else {
    html += `<div>Trade <b>2 ${resName}</b> → <b>1</b> of any resource.</div>`;
  }

  // Find which corners border this port's two land vertices.
  // Port edge midpoint → find the two vertices (v0, v1) of that edge.
  // Any settlement/city at those two vertices "owns" the port.
  const { px: cx, py: cy } = axialToPixel(port.x, port.y);
  const eIdx = EDGE_Z_TO_IDX[port.z] ?? port.z;
  const v0 = hexVertex(cx, cy, eIdx);
  const v1 = hexVertex(cx, cy, (eIdx + 1) % 6);
  const portVertices = [v0, v1];

  const settlements = turn?.settlements ?? {};
  const ownerSet = new Set();
  const threshold = SIZE * 0.4;

  for (const [, corner] of Object.entries(settlements)) {
    if (!corner.owner) continue;
    const { px: ccx, py: ccy } = axialToPixel(corner.x, corner.y);
    const vIdx = CORNER_Z_TO_VERTEX[corner.z] ?? corner.z;
    const vp = hexVertex(ccx, ccy, vIdx);
    for (const pv of portVertices) {
      if (Math.hypot(vp.x - pv.x, vp.y - pv.y) <= threshold) {
        ownerSet.add(corner.owner);
        break;
      }
    }
  }

  const playOrder = currentGameData?.data?.playOrder || [];
  const playerNums = {};
  playOrder.forEach((id, i) => { playerNums[id] = i + 1; });

  if (ownerSet.size > 0) {
    const playerList = buildPlayerAccessListHtml(ownerSet, playerNums, false);
    html += `<div style="margin-top:5px; display: flex; align-items: center;">Access: <span style="margin-left: 5px;">${playerList}</span></div>`;
  } else {
    html += `<div style="margin-top:5px;color:#94a3b8;">No players at this port yet.</div>`;
  }

  return html;
}

// ── HEX & PORT RENDER WITH TOOLTIPS ─────────────────────────────────────────

// We need to know the current turn when attaching listeners.
// Store a reference that updateAnalyticsView keeps current.
let _currentTooltipTurn = null;
let _currentTooltipMapState = null;

function renderHexPolygon(tile, tileIndex) {
  const { px, py } = axialToPixel(tile.x, tile.y);
  const poly = svgEl("polygon", {
    points: hexPolyPoints(px, py),
    class: `hex hex-type-${tile.type}`,
    style: "cursor:pointer;",
  });

  poly.addEventListener("mouseenter", (e) => {
    const html = buildHexTooltipHtml(tile, tileIndex, _currentTooltipTurn, _currentTooltipMapState);
    showTooltip(html, e);
  });
  poly.addEventListener("mousemove", positionTooltip);
  poly.addEventListener("mouseleave", hideTooltip);

  svg.appendChild(poly);
}

function renderHexLabels(tile) {
  const { px, py } = axialToPixel(tile.x, tile.y);
  if (tile.diceNumber > 0) {
    const isHot = tile.diceNumber === 6 || tile.diceNumber === 8;
    svg.appendChild(svgEl("circle", { cx: px, cy: py, r: 15, class: "dice-bg" }));
    svg.appendChild(svgText(
      {
        x: px, y: py - 2,
        class: `dice-label${isHot ? " hot" : ""}`
      },
      tile.diceNumber
    ));

    // Add probability pips (dots) below the number
    const numDots = 6 - Math.abs(tile.diceNumber - 7);
    const spacing = 4;
    const startX = px - ((numDots - 1) * spacing) / 2;
    for (let i = 0; i < numDots; i++) {
      svg.appendChild(svgEl("circle", {
        cx: startX + i * spacing,
        cy: py + 8,
        r: 1.2,
        fill: isHot ? "#c00" : "#222"
      }));
    }
  }
  svg.appendChild(svgText({ x: px, y: py + 22, class: "type-label" },
    HEX_TYPES[tile.type] ?? "?"));
  svg.appendChild(svgText({ x: px, y: py - 28, class: "coord-label" },
    `H(${tile.x},${tile.y})`));
}

function renderPort(port) {
  const { px: cx, py: cy } = axialToPixel(port.x, port.y);
  const eIdx = EDGE_Z_TO_IDX[port.z] ?? port.z;
  const mid = edgeMidByIdx(cx, cy, eIdx);
  const v0 = hexVertex(cx, cy, eIdx);
  const v1 = hexVertex(cx, cy, (eIdx + 1) % 6);

  // Port (x,y) is a SEA tile. The edge midpoint `mid` is on the coastline.
  // Push the port icon OUTWARD (away from center) so it sits in the sea.
  // Dashed lines then run from the shore (v0, v1) outward to the port.
  const pmLen = Math.sqrt(mid.x * mid.x + mid.y * mid.y) || 1;
  let outX = mid.x + (mid.x / pmLen) * 30;
  let outY = mid.y + (mid.y / pmLen) * 30;
  // Clamp to stay inside SVG circle (viewBox radius = 350)
  const outR = Math.sqrt(outX * outX + outY * outY);
  if (outR > 320) { outX *= 320 / outR; outY *= 320 / outR; }

  const info = PORT_TYPES[port.type] ?? { label: "?", name: "Unknown" };
  for (const v of [v0, v1]) {
    svg.appendChild(svgEl("line", { x1: v.x, y1: v.y, x2: outX, y2: outY, class: "port-line" }));
  }

  // Invisible hit-target circle so tooltip triggers over the whole port area
  const hitR = 22;
  const portCircle = svgEl("circle", { cx: outX, cy: outY, r: hitR, fill: "transparent", style: "cursor:pointer;" });
  const visCircle = svgEl("circle", { cx: outX, cy: outY, r: 16, class: `port port-type-${port.type}` });
  const label = svgText({ x: outX, y: outY, class: "port-label" }, info.label);

  const attachTooltip = (el) => {
    el.addEventListener("mouseenter", (e) => {
      const html = buildPortTooltipHtml(port, _currentTooltipTurn, _currentTooltipMapState);
      showTooltip(html, e);
    });
    el.addEventListener("mousemove", positionTooltip);
    el.addEventListener("mouseleave", hideTooltip);
  };

  svg.appendChild(visCircle);
  svg.appendChild(label);
  svg.appendChild(portCircle); // on top so it captures events
  attachTooltip(portCircle);
  attachTooltip(label);
}

function renderEdge(edge) {
  const { px: cx, py: cy } = axialToPixel(edge.x, edge.y);
  const eIdx = EDGE_Z_TO_IDX[edge.z] ?? edge.z;
  const { x, y } = edgeMidByIdx(cx, cy, eIdx);

  // Draw the orange circle
  svg.appendChild(svgEl("circle", { cx: x, cy: y, r: 3, class: "edge-point" }));
}

function renderEdgeLabel(edge) {
  const { px: cx, py: cy } = axialToPixel(edge.x, edge.y);
  const eIdx = EDGE_Z_TO_IDX[edge.z] ?? edge.z;
  const { x, y } = edgeMidByIdx(cx, cy, eIdx);
  svg.appendChild(svgText(
    {
      x: x,
      y: y + 10,
      class: "edge-label"
    },
    `E(${edge.x},${edge.y},${edge.z})`
  ));
}

function renderVertex(corner) {
  const { px: cx, py: cy } = axialToPixel(corner.x, corner.y);
  const vIdx = CORNER_Z_TO_VERTEX[corner.z] ?? corner.z;
  const { x, y } = hexVertex(cx, cy, vIdx);
  svg.appendChild(svgEl("circle", { cx: x, cy: y, r: 4, class: "vertex-point" }));
}

function renderVertexLabel(corner) {
  const { px: cx, py: cy } = axialToPixel(corner.x, corner.y);
  const vIdx = CORNER_Z_TO_VERTEX[corner.z] ?? corner.z;
  const { x, y } = hexVertex(cx, cy, vIdx);
  svg.appendChild(svgText({ x, y: y - 7, class: "vertex-label" },
    `V(${corner.x},${corner.y},${corner.z})`));
}

function edgeRotationDeg(cx, cy, eIdx) {
  const v0 = hexVertex(cx, cy, eIdx);
  const v1 = hexVertex(cx, cy, (eIdx + 1) % 6);
  return Math.atan2(v1.y - v0.y, v1.x - v0.x) * (180 / Math.PI);
}

function appendSvgImageOrFallback(attrs, fallbackFactory) {
  const img = svgEl("image", attrs);
  img.addEventListener("error", () => {
    img.remove();
    svg.appendChild(fallbackFactory());
  });
  svg.appendChild(img);
}

function renderSettlementPiece(settlement) {
  const { px: cx, py: cy } = axialToPixel(settlement.x, settlement.y);
  const vIdx = CORNER_Z_TO_VERTEX[settlement.z] ?? settlement.z;
  const p = hexVertex(cx, cy, vIdx);
  const colorName = PLAYER_COLOR_NAMES[settlement.owner];
  const href = colorName ? `./data/images/settlement_${colorName}.svg` : "";
  const size = 32;

  if (href) {
    appendSvgImageOrFallback({
      href,
      x: p.x - size / 2,
      y: p.y - size / 2,
      width: size,
      height: size,
      class: "piece-settlement"
    }, () => svgEl("circle", {
      cx: p.x,
      cy: p.y,
      r: 8,
      fill: "#fff",
      stroke: "#111",
      "stroke-width": 1.5
    }));
    return;
  }

  svg.appendChild(svgEl("circle", {
    cx: p.x,
    cy: p.y,
    r: 8,
    fill: "#fff",
    stroke: "#111",
    "stroke-width": 1.5
  }));
}

function renderRoadPiece(road) {
  const { px: cx, py: cy } = axialToPixel(road.x, road.y);
  const eIdx = EDGE_Z_TO_IDX[road.z] ?? road.z;
  const v0 = hexVertex(cx, cy, eIdx);
  const v1 = hexVertex(cx, cy, (eIdx + 1) % 6);
  const edgeLength = Math.hypot(v1.x - v0.x, v1.y - v0.y) || 1;
  const p = { x: (v0.x + v1.x) / 2, y: (v0.y + v1.y) / 2 };
  const colorName = PLAYER_COLOR_NAMES[road.owner];
  const href = colorName ? `./data/images/road_${colorName}.svg` : "";
  const width = Math.max(18, edgeLength - 16);
  const height = 48;
  const angle = edgeRotationDeg(cx, cy, eIdx) + 90;
  const transform = `rotate(${angle} ${p.x} ${p.y})`;

  if (href) {
    appendSvgImageOrFallback({
      href,
      x: p.x - width / 2,
      y: p.y - height / 2,
      width,
      height,
      preserveAspectRatio: "none",
      transform,
      class: "piece-road"
    }, () => svgEl("rect", {
      x: p.x - width / 2,
      y: p.y - height / 2,
      width,
      height,
      rx: 3,
      fill: "#fff",
      stroke: "#111",
      "stroke-width": 1,
      transform
    }));
    return;
  }

  svg.appendChild(svgEl("rect", {
    x: p.x - width / 2,
    y: p.y - height / 2,
    width,
    height,
    rx: 3,
    fill: "#fff",
    stroke: "#111",
    "stroke-width": 1,
    transform
  }));
}

function renderCityPiece(city) {
  const { px: cx, py: cy } = axialToPixel(city.x, city.y);
  const vIdx = CORNER_Z_TO_VERTEX[city.z] ?? city.z;
  const p = hexVertex(cx, cy, vIdx);
  const colorName = PLAYER_COLOR_NAMES[city.owner];

  // Per your requirement: ./data/images/city_${colorName}.svg
  const href = colorName ? `./data/images/city_${colorName}.svg` : "";
  const size = 42; // Cities are typically larger than settlements (32)

  if (href) {
    appendSvgImageOrFallback({
      href,
      x: p.x - size / 2,
      y: p.y - size / 2 - 10,
      width: size,
      height: size,
      class: "piece-city"
    }, () => svgEl("rect", { // Fallback to a square if image fails
      x: p.x - 10,
      y: p.y - 10,
      width: 20,
      height: 20,
      fill: "#fff",
      stroke: "#111",
      "stroke-width": 2
    }));
    return;
  }
}

function openingPlacementsFromEvents(gameData, mapState) {
  const events = gameData?.data?.eventHistory?.events ?? [];
  const lookupCorners = mapState?.tileCornerStates ?? {};
  const lookupEdges = mapState?.tileEdgeStates ?? {};
  const settlementsByIndex = new Map();
  const roadsByIndex = new Map();

  for (const event of events) {
    const stateChange = event?.stateChange ?? {};
    const mapChange = stateChange?.mapState ?? {};

    const changedCorners = mapChange?.tileCornerStates ?? {};
    for (const [cornerIndex, cornerState] of Object.entries(changedCorners)) {
      if (!cornerState?.owner || cornerState?.buildingType !== 1) continue;
      const baseCorner = lookupCorners[cornerIndex];
      if (!baseCorner) continue;
      settlementsByIndex.set(cornerIndex, {
        ...baseCorner,
        owner: cornerState.owner
      });
    }

    const changedEdges = mapChange?.tileEdgeStates ?? {};
    for (const [edgeIndex, edgeState] of Object.entries(changedEdges)) {
      if (!edgeState?.owner || edgeState?.type !== 1) continue;
      const baseEdge = lookupEdges[edgeIndex];
      if (!baseEdge) continue;
      roadsByIndex.set(edgeIndex, {
        ...baseEdge,
        owner: edgeState.owner
      });
    }

    if ((stateChange?.currentState?.completedTurns ?? 0) >= 8) break;
  }

  return {
    settlements: [...settlementsByIndex.values()],
    roads: [...roadsByIndex.values()]
  };
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function defaultCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function createPlaygroundPlayers(playerCount) {
  playgroundState.players = Array.from({ length: playerCount }, (_, idx) => ({
    id: `P${idx + 1}`,
    name: `Player ${idx + 1}`,
    resources: defaultCounts(RESOURCE_TYPES),
    devCards: defaultCounts(DEV_CARD_TYPES),
    rolls: []
  }));
  playgroundState.turnOrder = playgroundState.players.map((player) => player.id);
  playgroundState.currentTurnIndex = 0;
  playgroundState.rollHistory = [];
}

function currentTurnPlayer() {
  const currentId = playgroundState.turnOrder[playgroundState.currentTurnIndex];
  return playgroundState.players.find((player) => player.id === currentId) ?? null;
}

function renderPlayerSelector() {
  const selector = document.getElementById("playerSelector");
  if (!selector) return;
  selector.innerHTML = "";
  playgroundState.players.forEach((player) => {
    const option = document.createElement("option");
    option.value = player.id;
    option.textContent = player.name;
    selector.appendChild(option);
  });
}

function renderTurnOrder() {
  const list = document.getElementById("turnOrderList");
  const status = document.getElementById("turnStatus");
  const confirmBtn = document.getElementById("confirmTurnOrderBtn");
  if (!list || !status) return;

  if (!playgroundState.players.length) {
    list.innerHTML = "No players yet.";
    status.textContent = "No game initialized.";
    return;
  }

  list.innerHTML = "";
  playgroundState.turnOrder.forEach((playerId, index) => {
    const player = playgroundState.players.find((p) => p.id === playerId);
    if (!player) return;

    const row = document.createElement("div");
    row.className = `turn-row${index === playgroundState.currentTurnIndex ? " active-turn" : ""}`;

    const label = document.createElement("span");
    const playerIndex = playgroundState.players.indexOf(player);
    const colorKey = [1, 2, 3, 5][playerIndex % 4] || 1;
    const colorName = PLAYER_COLOR_NAMES[colorKey];
    const settlementImage = colorName ? `./data/images/settlement_${colorName}.svg` : "";

    const labelContent = document.createElement("div");
    labelContent.style.display = "flex";
    labelContent.style.alignItems = "center";
    labelContent.style.gap = "6px";
    if (settlementImage) {
      const img = document.createElement("img");
      img.src = settlementImage;
      img.alt = player.name;
      img.style.width = "16px";
      img.style.height = "16px";
      labelContent.appendChild(img);
    }
    const nameSpan = document.createElement("span");
    nameSpan.textContent = `${index + 1}. ${player.name}`;
    labelContent.appendChild(nameSpan);
    label.appendChild(labelContent);

    const controls = document.createElement("div");
    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.textContent = "Up";
    upBtn.disabled = index === 0 || playgroundState.turnOrderConfirmed;
    upBtn.addEventListener("click", () => {
      const tmp = playgroundState.turnOrder[index - 1];
      playgroundState.turnOrder[index - 1] = playgroundState.turnOrder[index];
      playgroundState.turnOrder[index] = tmp;
      if (playgroundState.currentTurnIndex === index) playgroundState.currentTurnIndex = index - 1;
      else if (playgroundState.currentTurnIndex === index - 1) playgroundState.currentTurnIndex = index;
      renderTurnOrder();
    });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.textContent = "Down";
    downBtn.disabled = index === playgroundState.turnOrder.length - 1 || playgroundState.turnOrderConfirmed;
    downBtn.addEventListener("click", () => {
      const tmp = playgroundState.turnOrder[index + 1];
      playgroundState.turnOrder[index + 1] = playgroundState.turnOrder[index];
      playgroundState.turnOrder[index] = tmp;
      if (playgroundState.currentTurnIndex === index) playgroundState.currentTurnIndex = index + 1;
      else if (playgroundState.currentTurnIndex === index + 1) playgroundState.currentTurnIndex = index;
      renderTurnOrder();
    });
    controls.appendChild(upBtn);
    controls.appendChild(downBtn);

    row.appendChild(label);
    row.appendChild(controls);
    list.appendChild(row);
  });

  const current = currentTurnPlayer();
  status.textContent = current ? `Current turn: ${current.name}` : "Current turn unavailable.";

  if (confirmBtn) {
    if (playgroundState.turnOrderConfirmed) {
      confirmBtn.textContent = "Turn Order Locked ✓";
      confirmBtn.disabled = true;
    } else {
      confirmBtn.textContent = "Confirm Turn Order";
      confirmBtn.disabled = false;
      confirmBtn.onclick = () => {
        playgroundState.turnOrderConfirmed = true;
        renderTurnOrder();
      };
    }
  }
}

function renderRollHistory() {
  const summary = document.getElementById("diceSummary");
  const history = document.getElementById("playgroundRollHistory");
  if (!summary || !history) return;

  if (!playgroundState.rollHistory.length) {
    summary.textContent = "No rolls recorded yet.";
    history.innerHTML = "";
    return;
  }

  const counts = playgroundState.rollHistory.reduce((acc, entry) => {
    acc[entry.value] = (acc[entry.value] || 0) + 1;
    return acc;
  }, {});
  summary.textContent = `Rolls tracked: ${playgroundState.rollHistory.length}. Latest: ${playgroundState.rollHistory[playgroundState.rollHistory.length - 1].value}`;
  history.innerHTML = playgroundState.rollHistory
    .slice()
    .reverse()
    .map((entry, idx) => {
      const turnsAgo = idx === 0 ? "latest" : `${idx} ago`;
      return `<div>${entry.playerName} rolled <strong>${entry.value}</strong> (${turnsAgo})</div>`;
    })
    .join("");
  history.innerHTML += `<hr><div>${Object.entries(counts).map(([roll, count]) => `${roll}:${count}`).join(" | ")}</div>`;
}

function renderPlayerTracker() {
  const tracker = document.getElementById("playerTracker");
  if (!tracker) return;

  if (!playgroundState.players.length) {
    tracker.innerHTML = "No players yet.";
    return;
  }

  tracker.innerHTML = playgroundState.players.map((player) => {
    // Get player color for settlement icon
    const playerIndex = playgroundState.players.indexOf(player);
    const colorKey = [1, 2, 3, 5][playerIndex % 4] || 1;
    const colorName = PLAYER_COLOR_NAMES[colorKey];
    const playerIcon = colorName ? `./data/images/player_bg_${colorName}.svg` : "";

    // Build resource display with images
    const resourcesHtml = RESOURCE_TYPES.map((type) => {
      const count = player.resources[type];
      const imagePath = RESOURCE_IMAGES[type];
      const label = { wood: "Wood", brick: "Brick", sheep: "Sheep", wheat: "Wheat", ore: "Ore" }[type];
      return `
        <div class="resource-item">
          <div class="card-label">${label}</div>
          <img src="${imagePath}" alt="${type}" class="resource-icon" title="${titleCase(type)}">
          <span class="resource-count">${count}</span>
        </div>
      `;
    }).join("");

    // Build dev cards display with images
    const devCardsHtml = DEV_CARD_TYPES.map((type) => {
      const count = player.devCards[type];
      const imagePath = DEV_CARD_IMAGES[type];
      const label = { knight: "Knight", victoryPoint: "Victory Point", roadBuilding: "Road Building", yearOfPlenty: "Year of Plenty", monopoly: "Monopoly" }[type];
      return `
        <div class="dev-card-item">
          <div class="card-label">${label}</div>
          <img src="${imagePath}" alt="${type}" class="dev-card-icon" title="${titleCase(type)}">
          <span class="dev-card-count">${count}</span>
        </div>
      `;
    }).join("");

    return `
      <div class="player-card">
        <div class="player-header">
          ${playerIcon ? `<img src="${playerIcon}" alt="${player.name}" class="player-settlement-icon">` : ""}
          <h3>${player.name}</h3>
        </div>
        <div class="resources-section">
          <strong>Resources:</strong>
          <div class="resources-grid">
            ${resourcesHtml}
          </div>
        </div>
        <div class="dev-cards-section">
          <strong>Dev Cards:</strong>
          <div class="dev-cards-grid">
            ${devCardsHtml}
          </div>
        </div>
        <div class="rolls-section">
          <strong>Dice rolls made:</strong> ${player.rolls.length}
        </div>
      </div>
    `;
  }).join("");
}

function renderPlayground() {
  renderPlayerSelector();
  renderTurnOrder();
  renderRollHistory();
  renderPlayerTracker();
}

function adjustPlayerInventory(kind, delta) {
  const playerId = document.getElementById("playerSelector")?.value;
  const amountId = kind === "resources" ? "resourceAmount" : "devCardAmount";
  const typeId = kind === "resources" ? "resourceType" : "devCardType";
  const amount = Number(document.getElementById(amountId)?.value ?? 1);
  const cardType = document.getElementById(typeId)?.value;
  if (!playerId || !cardType || !Number.isFinite(amount) || amount <= 0) return;
  const player = playgroundState.players.find((p) => p.id === playerId);
  if (!player) return;
  const next = (player[kind][cardType] || 0) + delta * amount;
  player[kind][cardType] = Math.max(0, next);
  renderPlayerTracker();
}

function initPlayground() {
  const createBtn = document.getElementById("createGameBtn");
  const addRollBtn = document.getElementById("addRollBtn");
  const nextTurnBtn = document.getElementById("nextTurnBtn");
  const prevTurnBtn = document.getElementById("prevTurnBtn");
  const addResourceBtn = document.getElementById("addResourceBtn");
  const removeResourceBtn = document.getElementById("removeResourceBtn");
  const addDevCardBtn = document.getElementById("addDevCardBtn");
  const removeDevCardBtn = document.getElementById("removeDevCardBtn");
  const countInput = document.getElementById("playerCount");
  const diceInput = document.getElementById("diceValue");

  createBtn?.addEventListener("click", () => {
    const count = Number(countInput?.value ?? 4);
    const safeCount = Math.min(8, Math.max(2, Number.isFinite(count) ? count : 4));
    createPlaygroundPlayers(safeCount);
    renderPlayground();
  });

  nextTurnBtn?.addEventListener("click", () => {
    if (!playgroundState.turnOrder.length) return;
    playgroundState.currentTurnIndex = (playgroundState.currentTurnIndex + 1) % playgroundState.turnOrder.length;
    playgroundState.lastRollerPlayerId = null; // Reset for new turn
    renderTurnOrder();
  });

  prevTurnBtn?.addEventListener("click", () => {
    if (!playgroundState.turnOrder.length) return;
    playgroundState.currentTurnIndex =
      (playgroundState.currentTurnIndex - 1 + playgroundState.turnOrder.length) % playgroundState.turnOrder.length;
    playgroundState.lastRollerPlayerId = null; // Reset for new turn
    renderTurnOrder();
  });

  addRollBtn?.addEventListener("click", () => {
    const roll = Number(diceInput?.value ?? 0);
    if (!Number.isInteger(roll) || roll < 2 || roll > 12) return;
    const player = currentTurnPlayer();
    if (!player) return;

    // Prevent same player from rolling twice in a row
    if (playgroundState.lastRollerPlayerId === player.id) {
      alert(`${player.name} already rolled this turn. Move to the next player first.`);
      return;
    }

    const entry = { value: roll, playerId: player.id, playerName: player.name };
    player.rolls.push(roll);
    playgroundState.rollHistory.push(entry);
    playgroundState.lastRollerPlayerId = player.id;
    renderRollHistory();
    renderPlayerTracker();
  });

  addResourceBtn?.addEventListener("click", () => adjustPlayerInventory("resources", 1));
  removeResourceBtn?.addEventListener("click", () => adjustPlayerInventory("resources", -1));
  addDevCardBtn?.addEventListener("click", () => adjustPlayerInventory("devCards", 1));
  removeDevCardBtn?.addEventListener("click", () => adjustPlayerInventory("devCards", -1));

  createPlaygroundPlayers(4);
  renderPlayground();
}

function initTabs() {
  const analyticsBtn = document.getElementById("analyticsTabBtn");
  const playgroundBtn = document.getElementById("playgroundTabBtn");
  const analyticsPanel = document.getElementById("analyticsTab");
  const playgroundPanel = document.getElementById("playgroundTab");
  const controls = document.getElementById("controls");

  const activateTab = (tabName) => {
    const analyticsActive = tabName === "analytics";
    analyticsBtn?.classList.toggle("active", analyticsActive);
    playgroundBtn?.classList.toggle("active", !analyticsActive);
    analyticsPanel?.classList.toggle("active", analyticsActive);
    playgroundPanel?.classList.toggle("active", !analyticsActive);
    // Show controls only in analytics mode
    if (controls) controls.style.display = analyticsActive ? "block" : "none";
  };

  analyticsBtn?.addEventListener("click", () => activateTab("analytics"));
  playgroundBtn?.addEventListener("click", () => activateTab("playground"));
}

// ── BOARD LOADING ────────────────────────────────────────────────────────────
async function loadGameBoard(gameId) {
  try {
    const res = await fetch(`./preprocessed-data/valid/${gameId}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const gameData = await res.json();
    const mapState = gameData?.data?.eventHistory?.initialState?.mapState;
    if (!mapState) throw new Error("mapState missing");

    // Store game data for turn parsing
    currentGameData = gameData;

    // Parse turns from events
    turnStates = parseTurnsFromEvents(gameData);

    // Update turn slider max value
    const slider = document.getElementById("turnSlider");
    if (slider) {
      slider.max = Math.max(turnStates.length - 1, 0);
      slider.value = 0;
    }

    // Render the initial state
    updateAnalyticsView(0);

    console.log(`Loaded: ${gameId} with ${turnStates.length} turns`);
  } catch (err) {
    console.error(err);
    svg.innerHTML = "";
    svg.appendChild(svgText({ x: 0, y: 0, class: "error-label" }, `Error: ${err.message}`));
  }
}

// ── GAME SELECTOR ────────────────────────────────────────────────────────────
const PAGE_SIZE = 500;
let _allGameIds = [];
let _currentPage = 1;

function totalPages() {
  return Math.max(1, Math.ceil(_allGameIds.length / PAGE_SIZE));
}

function populateSelectorForPage(page) {
  const selector = document.getElementById("gameSelector");
  if (!selector) return;

  _currentPage = Math.max(1, Math.min(page, totalPages()));

  const start = (_currentPage - 1) * PAGE_SIZE;
  const ids = _allGameIds.slice(start, start + PAGE_SIZE);

  selector.innerHTML = "";
  ids.forEach(id => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `Game ${id}`;
    selector.appendChild(opt);
  });

  // Sync pagination UI
  const pageInput = document.getElementById("pageInput");
  const pageTotalLabel = document.getElementById("pageTotalLabel");
  const pagePrevBtn = document.getElementById("pagePrevBtn");
  const pageNextBtn = document.getElementById("pageNextBtn");
  const countEl = document.getElementById("gameCount");

  if (pageInput) pageInput.value = _currentPage;
  if (pageTotalLabel) pageTotalLabel.textContent = `of ${totalPages()}`;
  if (pagePrevBtn) pagePrevBtn.disabled = _currentPage <= 1;
  if (pageNextBtn) pageNextBtn.disabled = _currentPage >= totalPages();
  if (countEl) {
    countEl.textContent =
      `(${start + 1}–${start + ids.length} of ${_allGameIds.length})`;
  }

  // Load the first game on the new page automatically
  if (ids.length > 0) loadGameBoard(ids[0]);
}

async function initSelector() {
  const selector = document.getElementById("gameSelector");
  if (!selector) return; // Game selector removed in playground mode
  try {
    const res = await fetch("./preprocessed-data/valid-index.json");
    _allGameIds = await res.json();

    // Wire up pagination controls
    const pagePrevBtn = document.getElementById("pagePrevBtn");
    const pageNextBtn = document.getElementById("pageNextBtn");
    const pageInput = document.getElementById("pageInput");
    const pageTotalLabel = document.getElementById("pageTotalLabel");

    if (pageTotalLabel) pageTotalLabel.textContent = `of ${totalPages()}`;
    if (pageInput) pageInput.max = totalPages();

    if (pagePrevBtn) {
      pagePrevBtn.addEventListener("click", () => {
        populateSelectorForPage(_currentPage - 1);
      });
    }
    if (pageNextBtn) {
      pageNextBtn.addEventListener("click", () => {
        populateSelectorForPage(_currentPage + 1);
      });
    }
    if (pageInput) {
      pageInput.addEventListener("change", () => {
        const requested = parseInt(pageInput.value);
        if (!isNaN(requested)) populateSelectorForPage(requested);
      });
      // Also respond to Enter key
      pageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const requested = parseInt(pageInput.value);
          if (!isNaN(requested)) populateSelectorForPage(requested);
        }
      });
    }

    selector.addEventListener("change", e => loadGameBoard(e.target.value));

    // Load page 1
    populateSelectorForPage(1);
  } catch (err) { console.error("Index load failed:", err); }
}

window.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initSelector();
  initPlayground();

  // Add turn slider listener for analytics mode
  const turnSlider = document.getElementById("turnSlider");
  const prevBtn = document.getElementById("prevAnalyticsTurnBtn");
  const nextBtn = document.getElementById("nextAnalyticsTurnBtn");

  if (turnSlider) {
    turnSlider.addEventListener("input", (e) => {
      const turnIndex = parseInt(e.target.value);
      updateAnalyticsView(turnIndex);
    });
  }

  if (prevBtn && turnSlider) {
    prevBtn.addEventListener("click", () => {
      let turnIndex = parseInt(turnSlider.value);
      if (turnIndex > parseInt(turnSlider.min)) {
        turnIndex--;
        turnSlider.value = turnIndex;
        updateAnalyticsView(turnIndex);
      }
    });
  }

  if (nextBtn && turnSlider) {
    nextBtn.addEventListener("click", () => {
      let turnIndex = parseInt(turnSlider.value);
      if (turnIndex < parseInt(turnSlider.max)) {
        turnIndex++;
        turnSlider.value = turnIndex;
        updateAnalyticsView(turnIndex);
      }
    });
  }
});

function renderRobberPiece(hexIndex, hexData) {
  if (!hexData) return;
  const { px, py } = axialToPixel(hexData.x, hexData.y);

  const size = 32;
  const href = "./data/images/icon_robber.svg";

  appendSvgImageOrFallback({
    href,
    x: px - size / 2 - 24,
    y: py - size / 2 + 6,
    width: size,
    height: size,
    class: "piece-robber"
  }, () => svgEl("circle", {
    cx: px - 24,
    cy: py + 6,
    r: 10,
    fill: "#444",
    stroke: "#000",
    "stroke-width": 1
  }));
}

function updateBankStateDisplay(turn) {
  const bankTracker = document.getElementById("analyticsBankTracker");
  if (!bankTracker) return;

  const resCounts = turn.bankState || { 1: 19, 2: 19, 3: 19, 4: 19, 5: 19 };
  const resMap = { 1: 'wood', 2: 'brick', 3: 'sheep', 4: 'wheat', 5: 'ore' };

  const resourcesHtml = [1, 2, 3, 4, 5].map(id => {
    const type = resMap[id];
    const count = resCounts[id] || 0;
    const imagePath = RESOURCE_IMAGES[type];
    return `
      <div class="resource-item" style="display: inline-flex; align-items: center; gap: 4px; margin-right: 8px;">
        <img src="${imagePath}" alt="${type}" title="${type}" style="width: 16px; height: 16px;">
        <span>${count}</span>
      </div>
    `;
  }).join("");

  const devCardCount = turn.bankDevCards ? turn.bankDevCards.length : 0;

  bankTracker.innerHTML = `
    <div style="font-size: 11px; color: #cbd5e1;">
      <strong>Resources:</strong><br>
      ${resourcesHtml}
    </div>
    <div style="font-size: 11px; color: #cbd5e1; margin-top: 6px;">
      <strong>Dev Cards:</strong> ${devCardCount} <img src=${`./data/images/card_devcardback.svg`} width="20" height="20" style="margin-right: 4px; vertical-align: middle;">
    </div>
  `;
}

function updateEventLogDisplay(turnIndex) {
  const logBox = document.getElementById("analyticsEventLog");
  if (!logBox) return;

  let allLogs = [];
  for (let i = 0; i <= turnIndex; i++) {
    if (turnStates[i] && turnStates[i].eventLogs) {
      allLogs = allLogs.concat(turnStates[i].eventLogs.map(log => ({ ...log, turn: i })));
    }
  }

  if (allLogs.length === 0) {
    logBox.innerHTML = "<p style='color: #94a3b8; font-size: 12px;'>No events yet</p>";
    return;
  }

  const resMap = { 1: 'lumber', 2: 'brick', 3: 'wool', 4: 'grain', 5: 'ore' };
  const altMap = { 1: 'wood', 2: 'brick', 3: 'sheep', 4: 'wheat', 5: 'ore' };
  const getResNames = (arr) => {
    if (!arr || arr.length === 0) return "";
    return arr.map(r => {
      const resName = resMap[r] || r;
      const altName = altMap[r] || r;
      const resImgPath = `./data/images/card_${resName}.svg`;
      return `<img src="${resImgPath}" alt="${altName}" title="${altName}" 
                 width="24" height="32" 
                 style="vertical-align: middle; margin: 0 2px; border-radius: 2px; box-shadow: 0 1px 3px rgba(0,0,0,0.3);">`;
    }).join("");
  };
  const getTileImage = (typeId) => {
    const resName = resMap[typeId];
    const altName = altMap[typeId];
    if (!resName) return ""; // Return empty for Desert or Water if not mapped

    const tileImgPath = `./data/images/tile_${resName}.svg`;
    return `<img src="${tileImgPath}" alt="${altName}" title="${altName}" 
               width="28" height="28" 
               style="vertical-align: middle; margin: 0 4px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));">`;
  };

  const getPlayerIcon = (id) => {
    const colorName = PLAYER_COLOR_NAMES[id] || "white";
    return `<img src="./data/images/player_bg_${colorName}.svg" width="20" height="20" style="margin-right: 4px; vertical-align: middle;">`;
  };

  const mapState = currentGameData?.data?.eventHistory?.initialState?.mapState ?? {};

  const logHtml = allLogs.slice().reverse().map(log => {
    const pIconHtml = getPlayerIcon(log.player);
    let text = "";

    switch (log.type) {
      case 'dice': text = `${pIconHtml} rolled <strong>${log.value}</strong>`; break;
      case 'gain': text = `${pIconHtml} gained: ${getResNames(log.resources.sort())}`; break;
      case 'discard': text = `${pIconHtml} discarded: ${getResNames(log.resources.sort())}`; break;
      case 'bankTrade': text = `${pIconHtml} traded ${getResNames(log.given)} for ${getResNames(log.received.sort())} with bank`; break;
      case 'tradeProposed': text = `${pIconHtml} proposed: ${getResNames(log.offered.sort())} for ${getResNames(log.wanted)}`; break;
      case 'tradeResponse': text = `${pIconHtml} ${log.status} the trade`; break;
      case 'tradeAccepted': {
        const proposerIcon = getPlayerIcon(log.proposer);
        const accepterIcon = getPlayerIcon(log.accepter);
        text = `${proposerIcon} completed trade with ${accepterIcon}: <br> ${proposerIcon} gave ${getResNames(log.offered.sort())} and got ${getResNames(log.received.sort())}`;
        break;
      }
      case 'buildingPurchased': {
        const typeLabel = log.building.charAt(0).toUpperCase() + log.building.slice(1);
        const imagePath = getBuildingImagePath(log.building, log.player);
        const itemText = log.count > 1 ? `${log.count} ${typeLabel}s` : `a ${typeLabel}`;
        text = `${pIconHtml} built <strong>${itemText}</strong> <img src="${imagePath}" alt="${typeLabel}" title="${typeLabel}" width="20" height="20" style="vertical-align: middle; margin: 0 4px;">`;
        break;
      }
      case 'devCardBought': {
        const imagePath = DEV_CARD_BACK_IMAGE;
        const cardText = log.count > 1 ? `${log.count} development cards` : 'a development card';
        text = `${pIconHtml} bought ${cardText} <img src="${imagePath}" alt="Dev Card" title="Development Card" width="20" height="20" style="vertical-align: middle; margin: 0 4px;">`;
        break;
      }
      case 'devCardPlayed': {
        const imagePath = DEV_CARD_IMAGES[log.cardType] || DEV_CARD_BACK_IMAGE;
        const label = DEV_CARD_LABELS[log.cardType] || log.cardType;
        const cardIcon = `<img src="${imagePath}" alt="${label}" title="${label}" width="20" height="20" style="vertical-align: middle; margin: 0 4px;">`;
        if (log.cardType === 'yearOfPlenty' && Array.isArray(log.resources) && log.resources.length > 0) {
          text = `${pIconHtml} played <b>${label}</b> ${cardIcon} and got ${getResNames(log.resources)}`;
        } else if (log.cardType === 'monopoly') {
          const stolenType = log.stolenResource !== undefined ? altMap[log.stolenResource] : null;
          const stolenTypeDisplay = stolenType ? `<img src="${RESOURCE_IMAGES[stolenType]}" alt="${stolenType}" title="${stolenType}" width="20" height="20" style="vertical-align: middle; margin: 0 2px;">` : null;

          if (stolenTypeDisplay) {
            const playOrder = currentGameData?.data?.playOrder || [];
            const otherPlayers = playOrder.filter(id => String(id) !== String(log.player));
            let playersToList = otherPlayers.length > 0 ? otherPlayers : Object.keys(log.stealsByVictim || {});

            let totalStolen = 0;
            const victimLines = playersToList.map(victimId => {
              const count = (log.stealsByVictim && log.stealsByVictim[victimId]) ? log.stealsByVictim[victimId] : 0;
              totalStolen += count;

              const colorName = PLAYER_COLOR_NAMES[victimId] || "white";
              const victimIcon = `<img src="./data/images/settlement_${colorName}.svg" alt="${colorName}" width="20" height="20" style="margin-right: 4px; vertical-align: middle;">`;

              let stolenHtml = '<span style="color: #94a3b8; font-size: 11px;">N/A</span>';
              if (count > 0) {
                stolenHtml = Array(count).fill(stolenTypeDisplay).join("");
              }
              return `<div style="margin-left: 20px; display: flex; align-items: center; margin-top: 2px;">${victimIcon} ${stolenHtml}</div>`;
            }).join('');

            text = `${pIconHtml} played <b>${label}</b> ${cardIcon} and stole ${totalStolen} ${stolenTypeDisplay}:<div style="margin-top: 4px;">${victimLines}</div>`;
          } else {
            text = `${pIconHtml} played <b>${label}</b> ${cardIcon}`;
          }
        } else {
          text = `${pIconHtml} played <b>${label}</b> ${cardIcon}`;
        }
        break;
      }
      case 'robberMoved': {
        const hex = mapState.tileHexStates?.[log.hexIndex];
        let hexInfo = "";

        if (hex) {
          const tileImg = getTileImage(hex.type);
          // Display: [Player Icon] moved the robber to [Tile Image] (Dice Number)
          hexInfo = `${tileImg} <strong>${hex.diceNumber}</strong>`;
        } else {
          hexInfo = `index ${log.hexIndex}`;
        }

        text = `${pIconHtml} moved the robber to ${hexInfo}`;
        break;
      }
      case 'stealDetail': {
        const victimIcon = getPlayerIcon(log.victim);
        text = `${pIconHtml} stole ${getResNames(log.resources)} from ${victimIcon}`;
        break;
      }
      case 'steal': {
        // Fallback if detail not available
        const victimIcon = getPlayerIcon(log.victim);
        text = `${pIconHtml} stole from ${victimIcon}`;
        break;
      }
    }

    return `<div style="margin-bottom: 6px; font-size: 11px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 4px;">
      <span style="color: #ffffff;"><strong>Turn ${log.turn}:</strong></span> ${text}
    </div>`;
  }).join("");

  logBox.innerHTML = logHtml;
}