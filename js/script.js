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
const DEV_CARD_IMAGES = {
  knight: "./data/images/card_knight.svg",
  victoryPoint: "./data/images/card_vp.svg",
  roadBuilding: "./data/images/card_roadbuilding.svg",
  yearOfPlenty: "./data/images/card_yearofplenty.svg",
  monopoly: "./data/images/card_monopoly.svg"
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
    playerStats: {},
    activePlayer: null
  };

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

    // Track dice rolls from log text
    if (stateChange.gameLogState) {
      for (const log of Object.values(stateChange.gameLogState)) {
        if (log?.text?.type === 10 && log.text.firstDice !== undefined && log.text.secondDice !== undefined) {
          const roll = log.text.firstDice + log.text.secondDice;
          currentTurn.diceRolls.push({
            value: roll,
            playerId: log.text.playerColor || log.from,
            turnNumber: currentTurn.turnNumber
          });
          currentTurn.diceRoll = roll;
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
        playerStats: JSON.parse(JSON.stringify(currentTurn.playerStats)),
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
  hexes.forEach(renderHexPolygon);
  ports.forEach(renderPort);
  edges.forEach(renderEdge);
  corners.forEach(renderVertex);
  hexes.forEach(renderHexLabels);

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

  // Update player tracker for analytics
  updateAnalyticsPlayerTracker(turn);
}

function updateDiceRollsDisplay(turn) {
  const rollHistory = document.getElementById("rollHistory");
  if (!rollHistory) return;

  const allRolls = [];
  for (let i = 0; i <= currentTurnIndex; i++) {
    if (turnStates[i] && turnStates[i].diceRolls) {
      allRolls.push(...turnStates[i].diceRolls);
    }
  }

  if (allRolls.length === 0) {
    rollHistory.innerHTML = "<p style='color: #94a3b8; font-size: 12px;'>No rolls yet</p>";
    return;
  }

  const counts = allRolls.reduce((acc, rollObj) => {
    acc[rollObj.value] = (acc[rollObj.value] || 0) + 1;
    return acc;
  }, {});


  const historyHtml = allRolls.slice().reverse().map(rollObj => {
    const colorName = PLAYER_COLOR_NAMES[rollObj.playerId] || "white";
    const playerIcon = `./data/images/player_bg_${colorName}.svg`;
    return `<div style="margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.05);"><strong>Turn ${rollObj.turnNumber}:</strong> <img src="${playerIcon}" width="20" height="20" style="margin-right: 4px; vertical-align: middle;"> rolled <strong>${rollObj.value}</strong></div>`;
  }).join("");

  rollHistory.innerHTML = `
    <div style="font-size: 12px;">
      <div style="margin-bottom: 8px;"><strong>Summary:</strong> ${Object.entries(counts).map(([roll, count]) => `${roll}:${count}`).join(" | ")}</div>
      <div style="max-height: 150px; overflow-y: auto; padding-right: 4px;">
        ${historyHtml}
      </div>
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
          Roads: ${playerRoads} <img src=${roadImage} width="20" height="20" style="margin-right: 4px; vertical-align: middle;">
          <br>
          Settlements: ${playerSettlements} <img src=${settlementImage} width="20" height="20" style="margin-right: 4px; vertical-align: middle;">
          <br>
          Cities: ${playerCities} <img src=${cityImage} width="20" height="20" style="margin-right: 4px; vertical-align: middle;">
        </div>
        <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 4px;">
          <strong>Stats:</strong> 
          <br>
          Longest Road: ${stats.longestRoad} <img src=${`./data/images/icon_longest_road.svg`} width="20" height="20" style="margin-right: 4px; vertical-align: middle;">  
          <br>
          Knights Played: ${stats.knightsPlayed} <img src=${`./data/images/icon_largest_army.svg`} width="20" height="20" style="margin-right: 4px; vertical-align: middle;"> 
        </div>
        <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 4px;">
          <strong>Resources:</strong><br>
          ${resourcesHtml}
        </div>
        <div style="font-size: 11px; color: #cbd5e1;">
          <strong>Dev Cards:</strong><br>
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

function renderHexPolygon(tile) {
  const { px, py } = axialToPixel(tile.x, tile.y);
  svg.appendChild(svgEl("polygon", {
    points: hexPolyPoints(px, py),
    class: `hex hex-type-${tile.type}`,
  }));
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
  svg.appendChild(svgEl("circle", { cx: outX, cy: outY, r: 16, class: `port port-type-${port.type}` }));
  svg.appendChild(svgText({ x: outX, y: outY, class: "port-label" }, info.label));
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
      y: p.y - size / 2,
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
  const history = document.getElementById("rollHistory");
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
const MAX_GAMES = 500;

async function initSelector() {
  const selector = document.getElementById("gameSelector");
  if (!selector) return; // Game selector removed in playground mode
  try {
    const res = await fetch("./preprocessed-data/valid-index.json");
    const allIds = await res.json();
    const ids = allIds.slice(0, MAX_GAMES);
    selector.innerHTML = "";
    ids.forEach(id => {
      const opt = document.createElement("option");
      opt.value = id; opt.textContent = `Game ${id}`;
      selector.appendChild(opt);
    });
    const countEl = document.getElementById("gameCount");
    if (countEl) countEl.textContent = `(showing ${ids.length} of ${allIds.length})`;
    selector.addEventListener("change", e => loadGameBoard(e.target.value));
    if (ids.length > 0) loadGameBoard(ids[0]);
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
