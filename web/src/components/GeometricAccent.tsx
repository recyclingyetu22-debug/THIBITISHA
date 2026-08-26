// Flat, sharp-edged geometric shape cluster — a corner accent in the style
// of the reference (Microsoft "By the Numbers": a mosaic of flat-colored
// triangles/diamonds in one corner, rest of the canvas calm/solid). Replaces
// the earlier soft blurred gradient approach entirely: no blur, no
// transparency falloff, confident flat brand-color shapes with hard edges.
// Fixed to the viewport corner (not the page), so it reads as a persistent
// brand mark rather than scrolling content; pointer-events: none so it
// never intercepts clicks.
const CELL = 54;
const COLS = 6;
const ROWS = 6;

// Cycles through the brand palette — indigo, teal, violet, plus one neutral
// "paper" tone per theme (set via currentColor/CSS var below) so the mosaic
// reads as deliberately restrained, not a random rainbow.
const PALETTE_VARS = ["var(--brand-primary)", "var(--brand-accent)", "var(--accent-violet)", "var(--surface-alt)"];

function triangleFill(row: number, col: number): string {
  const index = (row * 7 + col * 3) % PALETTE_VARS.length;
  return PALETTE_VARS[index];
}

export function GeometricAccent() {
  const width = COLS * CELL;
  const height = ROWS * CELL;
  const triangles: { d: string; fill: string; opacity: number }[] = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = col * CELL;
      const y = row * CELL;
      const flip = (row + col) % 2 === 0;
      const upper = flip ? `M${x},${y} L${x + CELL},${y} L${x},${y + CELL} Z` : `M${x},${y} L${x + CELL},${y} L${x + CELL},${y + CELL} Z`;
      const lower = flip ? `M${x + CELL},${y} L${x + CELL},${y + CELL} L${x},${y + CELL} Z` : `M${x},${y} L${x + CELL},${y + CELL} L${x},${y + CELL} Z`;
      // Sparse: skip a chunk of cells so it reads as a mosaic fading into
      // the corner, not a full solid tile filling the whole square.
      const distanceFromCorner = row + col;
      if (distanceFromCorner > ROWS + 1) continue;
      triangles.push({ d: upper, fill: triangleFill(row, col), opacity: distanceFromCorner > ROWS - 2 ? 0.55 : 1 });
      if (distanceFromCorner <= ROWS - 2) {
        triangles.push({ d: lower, fill: triangleFill(row, col + 1), opacity: 0.85 });
      }
    }
  }

  return (
    <svg
      className="geometric-accent"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      {triangles.map((t, i) => (
        <path key={i} d={t.d} fill={t.fill} opacity={t.opacity} />
      ))}
    </svg>
  );
}
