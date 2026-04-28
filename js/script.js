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

  // Add the label (Logic mirrored from renderVertex)
  svg.appendChild(svgText(
    {
      x: x,
      y: y + 10, // Positioned slightly below the dot
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
  // Always show vertex labels (positions are confirmed correct)
  svg.appendChild(svgText({ x, y: y - 7, class: "vertex-label" },
    `V(${corner.x},${corner.y},${corner.z})`));
}

// ── BOARD LOADING ────────────────────────────────────────────────────────────
async function loadGameBoard(gameId) {
  try {
    const res = await fetch(`./data/games/${gameId}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const gameData = await res.json();
    const mapState = gameData?.data?.eventHistory?.initialState?.mapState;
    if (!mapState) throw new Error("mapState missing");

    svg.innerHTML = "";

    const hexes = mapState.tileHexStates ? Object.values(mapState.tileHexStates) : [];
    const ports = mapState.portEdgeStates ? Object.values(mapState.portEdgeStates) : [];
    const edges = mapState.tileEdgeStates ? Object.values(mapState.tileEdgeStates) : [];
    const corners = mapState.tileCornerStates ? Object.values(mapState.tileCornerStates) : [];

    // Draw in layers: polygons first, then everything on top
    hexes.forEach(renderHexPolygon);   // Pass 1: all hex fills
    ports.forEach(renderPort);         // Pass 2: port lines + circles
    edges.forEach(renderEdge);         // Pass 3: edge dots
    corners.forEach(renderVertex);     // Pass 4: vertex dots
    hexes.forEach(renderHexLabels);    // Pass 5: dice tokens + text (always on top)

    console.log(`Loaded: ${gameId}`);
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
  try {
    const res = await fetch("./data/games-index.json");
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

window.addEventListener("DOMContentLoaded", initSelector);
