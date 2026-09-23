import { MAP_DISTRICTS, MAP_LAKES, MAP_RIVER } from './map-geometry.js';
import { MEASURES } from './model.js';

export const projectMapPoint = ({ x, y }) => ({ x: .9 * x + .38 * y - 88, y: -.28 * x + .64 * y + 242 });
const measures = new Map(MEASURES.map(measure => [measure.id, measure]));
const GAP = 4;
const MAX_PER_DISTRICT = 5;

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

function candidatesFor(district, scale) {
  const xs = district.polygon.map(p => p.x), ys = district.polygon.map(p => p.y);
  const candidates = [];
  for (let y = Math.min(...ys) + 8; y < Math.max(...ys) - 4; y += 5) {
    for (let x = Math.min(...xs) + 10; x < Math.max(...xs) - 10; x += 5) {
      const slot = { x, y, scale, districtId: district.id };
      if (MAP_LABEL_BOUNDS.some(label => boxesOverlap(objectBounds(slot), label)) || !validFootprint(slot, district)) continue;
      candidates.push({ ...slot, clearance: edgeDistance(slot, district.polygon) });
    }
  }
  return candidates;
}

export function createObjectSlots() {
  // Reserve five positions per district once, including room for the tallest asset.
  // Allocation is independent of selected measures, so additions never shuffle the city.
  const attempted = [];
  for (const scale of [.95, .9, .85, .8, .75]) {
    const groups = OBJECT_DISTRICTS.filter(district => district.id !== 'saryarka').map(district => ({ district, candidates: candidatesFor(district, scale) }))
      .sort((a, b) => a.candidates.length - b.candidates.length);
    const saryarka = [[123,299],[124,331],[155,298],[289,294],[321,292]].map(([x,y], slot) => ({ x,y,slot,scale:.6,districtId:'saryarka' }));
    const occupied = [...saryarka];
    const slots = { saryarka };
    for (const { district, candidates } of groups) {
      const selected = [];
      while (selected.length < MAX_PER_DISTRICT) {
        const available = candidates.filter(candidate => !occupied.some(other => boxesOverlap(objectBounds(candidate), objectBounds(other))));
        if (!available.length) break;
        // Prefer positions with air around them, then spread subsequent objects out.
        const score = candidate => {
          const separation = selected.length ? Math.min(...selected.map(other => Math.hypot(candidate.x - other.x, candidate.y - other.y))) : 0;
          return candidate.clearance + separation * .7;
        };
        available.sort((a, b) => score(b) - score(a) || a.y - b.y || a.x - b.x);
        const chosen = { ...available[0], slot: selected.length };
        selected.push(chosen);
        occupied.push(chosen);
      }
      slots[district.id] = selected;
    }
    if (Object.values(slots).every(items => items.length === MAX_PER_DISTRICT)) return slots;
    attempted.push({ scale, counts: Object.fromEntries(Object.entries(slots).map(([id, items]) => [id, items.length])) });
  }
  throw new Error(`Map geometry has insufficient room for scenario objects: ${JSON.stringify(attempted)}`);
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
  const placed = previous.filter(item => wanted.has(item.key));
  for (const request of requests) {
    if (placed.some(item => item.key === request.key)) continue;
    const position = slots[request.districtId].find(slot => !placed.some(item => item.districtId === request.districtId && item.slot === slot.slot));
    if (!position) throw new Error('Scenario exceeds the map object capacity.');
    placed.push({ ...position, ...request });
  }
  return placed.sort((a, b) => a.y - b.y || a.x - b.x);
}
