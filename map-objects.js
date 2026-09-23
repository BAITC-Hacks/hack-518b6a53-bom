import { MAP_DISTRICTS, MAP_LAKES, MAP_RIVER } from './map-geometry.js';
import { MEASURES } from './model.js';

export const projectMapPoint = ({ x, y }) => ({ x: .9 * x + .38 * y - 88, y: -.28 * x + .64 * y + 242 });
const measures = new Map(MEASURES.map(measure => [measure.id, measure]));
const GAP = 4;
const MAX_PER_DISTRICT = 5;
const MAX_OBJECT_SCALE = 1.3;

// These map paths consist only of absolute M/L/Z commands.
const polygonFromPath = path => {
  const values = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return Array.from({ length: values.length / 2 }, (_, i) => projectMapPoint({ x: values[i * 2], y: values[i * 2 + 1] }));
};
export const OBJECT_DISTRICTS = MAP_DISTRICTS.map(district => ({ ...district, polygon: polygonFromPath(district.path) }));
const lakes = MAP_LAKES.map(polygonFromPath);
const river = polygonFromPath(MAP_RIVER);
export function mapLabelPosition(district) {
  return projectMapPoint(district.centroid);
}
export const MAP_LABEL_BOUNDS = MAP_DISTRICTS.map(district => {
  const center = mapLabelPosition(district);
  if (district.id === 'saryarka') return { left: center.x - 49, right: center.x + 49, top: center.y - 23, bottom: center.y + 19 };
  return { left: center.x - 54, right: center.x + 54, top: center.y - 25, bottom: center.y + 21 };
});

export function containsPoint(polygon, { x, y }) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
const edgeDistance = (point, polygon) => Math.min(...polygon.map((a, i) => segmentDistance(point, a, polygon[(i + 1) % polygon.length])));
export function boxesOverlap(a, b, gap = GAP) {
  return a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
}
export function objectBounds({ x, y, scale }) {
  return { left: x - 23 * scale, right: x + 23 * scale, top: y - 40 * scale, bottom: y + 6 * scale };
}

export function validFootprint(slot, district) {
  // Test the entire base, keeping structures away from shores and district edges.
  if (!containsPoint(district.polygon, slot)) return false;
  for (let dx = -23; dx <= 23; dx += 4.6) {
    for (const dy of [-10, -2, 6]) {
      const point = { x: slot.x + dx * slot.scale, y: slot.y + dy * slot.scale };
      if (!containsPoint(district.polygon, point) || edgeDistance(point, district.polygon) < 2) return false;
      if (lakes.some(lake => containsPoint(lake, point) || edgeDistance(point, lake) < 2)) return false;
      if (river.some((a, i) => i && segmentDistance(point, river[i - 1], a) < 4)) return false;
    }
  }
  // Reject a small lake entirely enclosed by the footprint as well.
  return !lakes.some(lake => lake.some(p => Math.abs(p.x - slot.x) < 23 * slot.scale && p.y > slot.y - 10 * slot.scale && p.y < slot.y + 6 * slot.scale));
}

const makeSlots = (districtId, positions) => positions.map(([x, y, scale], slot) => ({ x, y, scale, slot, districtId }));

// Precomputed against the fixed map geometry, reserving the tallest drawing
// and four units around labels/objects. The geometry tests validate every
// density variant; loading the page does not run an expensive packing search.
const saryarkaLayouts = Object.fromEntries([
  [],
  [[141.22,318.76,1.15]],
  [[141.22,318.76,1.15],[316.22,303.76,1.15]],
  [[141.22,318.76,1.15],[291.22,313.76,.65],[326.22,308.76,.65]],
  [[136.22,333.76,.65],[291.22,313.76,.65],[326.22,308.76,.65],[136.22,298.76,.65]],
  [[123,299,.6],[124,331,.6],[155,298,.6],[289,294,.6],[321,292,.6]]
].map((positions, count) => [count, makeSlots('saryarka', positions)]));

export function createObjectSlots() {
  return {
    saryarka: saryarkaLayouts[MAX_PER_DISTRICT].map(slot => ({ ...slot })),
    esil: makeSlots('esil', [[539.92,359.24,1.3],[394.92,369.24,.9],[404.92,419.24,.9],[484.92,364.24,.9],[564.92,409.24,.85]]),
    almaty: makeSlots('almaty', [[545.1,238,1.3],[625.1,273,1.25],[435.1,323,1],[685.1,268,1],[455.1,273,1]]),
    baikonur: makeSlots('baikonur', [[418.32,218.96,1.05],[248.32,248.96,1],[198.32,268.96,1],[468.32,213.96,.95],[478.32,163.96,.9]]),
    nura: makeSlots('nura', [[314.5,378.24,1.3],[189.5,433.24,1.15],[209.5,373.24,1.05],[284.5,483.24,1.05],[359.5,473.24,1.05]])
  };
}

const slots = createObjectSlots();

export function layoutMapObjects(decisions, previous = []) {
  const requests = decisions.flatMap(decision => {
    const measure = measures.get(decision.id);
    if (!measure) return [];
    const targets = measure.scope === 'city' ? MAP_DISTRICTS : MAP_DISTRICTS.filter(d => d.id === decision.districtId);
    return targets.map(district => ({ key: `${decision.id}:${district.id}`, measureId: decision.id, districtId: district.id }));
  });
  const wanted = new Set(requests.map(request => request.key));
  const placed = previous.filter(item => wanted.has(item.key) && item.districtId !== 'saryarka').map(item => ({
    ...item, ...slots[item.districtId].find(slot => slot.slot === item.slot)
  }));
  const saryarkaRequests = requests.filter(request => request.districtId === 'saryarka');
  const saryarkaPositions = saryarkaLayouts[saryarkaRequests.length];
  if (!saryarkaPositions) throw new Error('Scenario exceeds the map object capacity.');
  // Retain slot identities where possible, then fill the holes. Every redraw
  // at the same density is stable, including focus and language changes.
  for (const request of saryarkaRequests) {
    const oldPosition = previous.find(item => item.key === request.key);
    const position = oldPosition && saryarkaPositions.find(slot => slot.slot === oldPosition.slot);
    if (position) placed.push({ ...position, ...request });
  }
  for (const request of requests) {
    if (placed.some(item => item.key === request.key)) continue;
    const positions = request.districtId === 'saryarka' ? saryarkaPositions : slots[request.districtId];
    const position = positions.find(slot => !placed.some(item => item.districtId === request.districtId && item.slot === slot.slot));
    if (!position) throw new Error('Scenario exceeds the map object capacity.');
    placed.push({ ...position, ...request });
  }
  // Grow into currently empty space without moving anchors. Start from the
  // reserved sizes each time, so returning to a scenario restores its layout.
  // A fixed key order prevents focus, rendering order or language from changing
  // the result. Every scale is checked against the entire drawing's bounds.
  for (const object of [...placed].sort((a, b) => a.key.localeCompare(b.key))) {
    const district = OBJECT_DISTRICTS.find(item => item.id === object.districtId);
    for (let step = Math.round(object.scale * 100) + 5; step <= MAX_OBJECT_SCALE * 100; step += 5) {
      const candidate = { ...object, scale: step / 100 };
      const bounds = objectBounds(candidate);
      if (!validFootprint(candidate, district) || MAP_LABEL_BOUNDS.some(label => boxesOverlap(bounds, label)) ||
          placed.some(other => other !== object && boxesOverlap(bounds, objectBounds(other)))) break;
      object.scale = candidate.scale;
    }
  }
  return placed.sort((a, b) => a.y - b.y || a.x - b.x);
}
