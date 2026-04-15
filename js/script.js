const data = {
  0: { x: 0, y: -2, type: 4, diceNumber: 4 },
  1: { x: -1, y: -1, type: 3, diceNumber: 11 },
  2: { x: -2, y: 0, type: 3, diceNumber: 12 },
  3: { x: -2, y: 1, type: 2, diceNumber: 9 },
  4: { x: -2, y: 2, type: 3, diceNumber: 10 },
  5: { x: -1, y: 2, type: 4, diceNumber: 8 },
  6: { x: 0, y: 2, type: 1, diceNumber: 3 },
  7: { x: 1, y: 1, type: 0, diceNumber: 0 },
  8: { x: 2, y: 0, type: 3, diceNumber: 6 },
  9: { x: 2, y: -1, type: 2, diceNumber: 2 },
  10: { x: 2, y: -2, type: 2, diceNumber: 5 },
  11: { x: 1, y: -2, type: 1, diceNumber: 8 },
  12: { x: 0, y: -1, type: 1, diceNumber: 3 },
  13: { x: -1, y: 0, type: 1, diceNumber: 6 },
  14: { x: -1, y: 1, type: 4, diceNumber: 5 },
  15: { x: 0, y: 1, type: 5, diceNumber: 4 },
  16: { x: 1, y: 0, type: 5, diceNumber: 9 },
  17: { x: 1, y: -1, type: 5, diceNumber: 10 },
  18: { x: 0, y: 0, type: 4, diceNumber: 11 },
};

const size = 55; // Radius of the hexagon
const svg = document.getElementById("catanBoard");

function getHexPoints() {
  let points = [];
  for (let i = 0; i < 6; i++) {
    const angle_deg = 60 * i;
    const angle_rad = (Math.PI / 180) * angle_deg;
    points.push(`${size * Math.cos(angle_rad)},${size * Math.sin(angle_rad)}`);
  }
  return points.join(" ");
}

Object.values(data).forEach((tile) => {
  // Convert axial to pixel
  const px = size * 1.5 * tile.x;
  const py = size * Math.sqrt(3) * (tile.y + tile.x / 2);

  // Create Hexagon
  const hex = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  hex.setAttribute("points", getHexPoints());
  hex.setAttribute("class", `hex type-${tile.type}`);
  hex.setAttribute("transform", `translate(${px}, ${py})`);
  svg.appendChild(hex);

  // Add Dice Number (if not desert)
  if (tile.diceNumber > 0) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", px);
    text.setAttribute("y", py + 5);
    text.setAttribute("class", "label");
    text.textContent = tile.diceNumber;
    svg.appendChild(text);
  }
});
