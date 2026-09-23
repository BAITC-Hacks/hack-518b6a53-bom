// Small isometric city objects. Every drawing, including its shadow, fits
// x [-23, 23], y [-40, 6], with its ground anchor at (0, 0).
const p = (points, fill, extra = '') => `<polygon points="${points}" fill="${fill}" ${extra}/>`;
const path = (d, stroke, width = 1, extra = '') => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;
const circle = (x, y, r, fill, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${extra}/>`;
const ellipse = (x, y, rx, ry, fill, extra = '') => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const rect = (x, y, width, height, fill, extra = '') => `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" ${extra}/>`;
const group = (x, y, content, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})">${content}</g>`;

function ground(fill = '#e0eff6') {
  return ellipse(0, 1.5, 22, 4.5, '#806834', 'opacity=".16"') +
    p('-21,-5 0,4 0,6 -21,-3', '#c7d8df') +
    p('0,4 21,-5 21,-3 0,6', '#94b7ca') +
    p('-21,-5 0,-14 21,-5 0,4', fill);
}

// A box whose front bottom corner is (x, y). Both floor axes follow
// the same 2:1 isometric projection as the miniature roads and gardens.
function box(x, y, left, right, height, top, light, shade) {
  const a = [x - left, y - left / 2];
  const b = [x, y];
  const c = [x + right, y - right / 2];
  const d = [x - left + right, y - (left + right) / 2];
  return p(`${a[0]},${a[1] - height} ${b[0]},${b[1] - height} ${b} ${a}`, light) +
    p(`${b[0]},${b[1] - height} ${c[0]},${c[1] - height} ${c} ${b}`, shade) +
    p(`${a[0]},${a[1] - height} ${d[0]},${d[1] - height} ${c[0]},${c[1] - height} ${b[0]},${b[1] - height}`, top);
}

function tree(x, y, scale = 1, green = '#62afb3') {
  return group(x, y,
    path('M0,-15V0', '#887358', 2.8) +
    p('0,-30 -9,-16 -5,-16 -11,-7 0,-2 11,-7 5,-16 9,-16', green) +
    p('0,-30 0,-2 11,-7 5,-16 9,-16', '#347f91') +
    p('0,-30 -9,-16 0,-12 9,-16', '#a5d2cf'), scale);
}

function vehicle(top = '#ecf6fd', side = '#78b9dc', front = '#5294bd') {
  return p('-17,-19 3,-28 17,-21 -3,-12', top) +
    p('-17,-19 -3,-12 -3,-2 -17,-9', front) +
    p('-3,-12 17,-21 17,-11 -3,-2', side) +
    p('-15,-17 -5,-12 -5,-7 -15,-12', '#d5ecf7') +
    p('-1,-12 15,-19 15,-14 -1,-7', '#315f7c') +
    path('M4,-14V-9 M10,-17V-12', '#d8eef8', 1) +
    path('M-1,-5L15,-12', top, 1) +
    ellipse(1, -2.8, 2, 2.4, '#2d5067') +
    ellipse(12, -7.8, 2, 2.4, '#2d5067') +
    circle(1, -2.8, .8, '#cddfe8') + circle(12, -7.8, .8, '#cddfe8') +
    p('-16,-10 -13,-8.5 -13,-6.5 -16,-8', '#fff2bd') +
    p('-7,-5.5 -4,-4 -4,-2.5 -7,-4', '#fff2bd');
}

const illustrations = {
  // Bus lane and bus.
  M1: () => ground('#bbd7e4') +
    p('-20,-5 0,-13 20,-5 0,3', '#94b6c8') +
    path('M-17,-5L3,-13 M-2,3L18,-5', '#edf7fc', 1.2) +
    vehicle(),

  // Smart traffic lights above a small intersection.
  M2: () => ground('#c7d8e1') +
    p('-18,-5 -11,-8 15,-1 8,2', '#edf5f8') +
    path('M-16,-7L14,1 M-10,-10L20,-2', '#8ba9b8', 1) +
    ellipse(0, -.5, 4, 1.5, '#7498ac') +
    path('M0,-1V-19', '#5a8198', 3) +
    p('-4,-35 -1,-37 7,-37 4,-35', '#a2c3d3') +
    p('4,-35 7,-37 7,-17 4,-15', '#31566f') +
    rect(-4, -35, 8, 20, '#4b7590', 'rx="2"') +
    circle(0, -31, 2.2, '#d38a75') +
    circle(0, -25, 2.2, '#e7c989') +
    circle(0, -19, 2.2, '#b9e4ac') +
    circle(-.5, -19.6, .7, '#eff7dc'),

  // Light rail with tracks and a pantograph.
  M3: () => ground('#ccdce4') +
    path('M-19,-2L7,-14 M-8,4L20,-8', '#7894a5', 1.8) +
    path('M-14,-1L-8,2 M-8,-4L-2,-1 M-2,-7L4,-4 M4,-10L10,-7 M10,-13L16,-10', '#f2f7fa', 1.2) +
    vehicle('#eff7fc', '#94c8e1', '#5d98ba') +
    path('M-1,-26L-5,-31 1,-35 5,-30 1,-26 M-3,-36L6,-36', '#567f98', 1.4) +
    p('-10,-22 0,-27 4,-25 -6,-20', '#e2c681'),

  // Park, path, a tree and a wooden bench.
  M4: () => ground('#bfddd2') +
    p('-17,-6 -12,-8 12,1 7,3', '#eee5c8') +
    p('-12,-8 -7,-10 -1,-7 -6,-5', '#eee5c8') +
    tree(-9, -5, .87) +
    path('M3,-2V-7 M14,-7V-12', '#69867f', 1.5) +
    p('1,-9 13,-14 17,-12 5,-7', '#cda577') +
    p('5,-7 17,-12 17,-10 5,-5', '#a08059') +
    path('M2,-12L14,-17 M2,-14L14,-19', '#cda577', 2) +
    path('M2,-16V-8 M14,-21V-13', '#69867f', 1.2) +
    circle(-4, -1, 1.5, '#e6c59b') + circle(-1, -.3, 1, '#c5a7a5'),

  // A clean energy house, with a blue solar roof.
  M5: () => ground('#dce9e1') +
    box(0, 0, 14, 13, 15, '#f0e2c4', '#d9edf7', '#9fc6db') +
    p('-17,-23 -3,-34 3,-28 -1,-14', '#9ecbde') +
    p('-3,-34 16,-25 16,-21 -1,-14', '#508cab') +
    p('-1,-30 11,-24 8,-20 -4,-26', '#245779') +
    path('M3,-28L0,-24 M7,-26L4,-22 M-2,-28L10,-22', '#b9e3f1', .8) +
    p('-11,-17 -6,-14.5 -6,-9.5 -11,-12', '#5a9ec6') +
    p('4,-12 9,-14.5 9,-9.5 4,-7', '#5a9ec6') +
    p('-4,-9 0,-7 0,0 -4,-2', '#997f60') +
    path('M16,-4V-10', '#50939c', 1.5) +
    p('16,-10 12,-14 12,-10 16,-7 20,-13 20,-16', '#66adb0'),

  // A grove rather than a single park tree.
  M6: () => ground('#b9dcd6') +
    tree(-10, -5, .78, '#61a2a8') +
    tree(8, -6, 1.03, '#75b8bc') +
    tree(-1, 1, .7, '#93c6bd') +
    circle(-16, -2, 1.4, '#d5e7cf') + circle(13, -2, 1.8, '#d5e7cf'),

  // School with a warm roof, windows and a flag.
  M7: () => ground('#e6e6d3') +
    box(0, 0, 16, 16, 19, '#f5dda0', '#dceffa', '#a6cddd') +
    p('-18,-27 -2,-35 18,-27 1,-19', '#e6bc59') +
    p('-18,-27 1,-19 1,-16 -18,-24', '#b68b38') +
    p('1,-19 18,-27 18,-24 1,-16', '#cca447') +
    p('-13,-21 -9,-19 -9,-15 -13,-17', '#79b5d3') +
    p('-7,-18 -3,-16 -3,-12 -7,-14', '#79b5d3') +
    p('4,-16 8,-18 8,-14 4,-12', '#6297b7') +
    p('10,-19 14,-21 14,-17 10,-15', '#6297b7') +
    p('-13,-13 -9,-11 -9,-7 -13,-9', '#79b5d3') +
    p('10,-11 14,-13 14,-9 10,-7', '#6297b7') +
    p('-4,-9 0,-7 0,0 -4,-2', '#997f60') +
    path('M-3,-32V-39', '#648ca2', 1) +
    p('-2.5,-39 5,-37 -2.5,-35', '#6fb7de'),

  // Clinic: cool white facade and a prominent red medical cross.
  M8: () => ground('#d2e7ef') +
    box(0, 0, 15, 15, 22, '#f2f8fc', '#edf6fc', '#a2ccdf') +
    p('-15,-29.5 0,-37 15,-29.5 0,-22', '#c9e6f3') +
    p('-4,-30 0,-32 4,-30 0,-28', '#edf7fb') +
    p('-11,-22 -8,-20.5 -8,-17.5 -5,-16 -5,-13 -8,-14.5 -8,-11.5 -11,-13 -11,-16 -14,-17.5 -14,-20.5 -11,-19', '#c97666') +
    p('4,-22 10,-25 10,-20 4,-17', '#518eb3') +
    p('4,-14 10,-17 10,-12 4,-9', '#518eb3') +
    p('-5,-8 0,-5.5 0,0 -5,-2.5', '#6299b7') +
    path('M-2.5,-6.5V-1.5', '#c7e1ee', .8),

  // Sports court, markings, net and basketball hoop.
  M9: () => ground('#b3d5db') +
    p('-18,-5 0,-13 18,-5 0,3', '#6daebd') +
    p('-15,-5 0,-11.5 15,-5 0,1.5', 'none', 'stroke="#f3f8fb" stroke-width=".8"') +
    path('M-7.5,-8.3L7.5,-1.7', '#f3f8fb', .8) +
    ellipse(0, -5, 3.6, 1.6, 'none', 'stroke="#f3f8fb" stroke-width=".8"') +
    path('M-16,-5V-16 M16,-5V-16 M-16,-16L0,-23 16,-16 M-16,-12L0,-19 16,-12', '#739dad', 1) +
    path('M-8,-19.5V-9 M0,-23V-13 M8,-19.5V-9', '#90b6c1', .8) +
    path('M12,-6V-24', '#577e97', 1.5) +
    p('6,-28 16,-24 16,-17 6,-21', '#f0f7fa') +
    p('9,-25 13,-23.5 13,-21 9,-22.5', 'none', 'stroke="#c39174" stroke-width=".8"') +
    ellipse(10, -20, 3, 1.2, 'none', 'stroke="#c39174" stroke-width="1.3"') +
    path('M7.5,-19.5L8.5,-16 11.5,-16 12.5,-19.5', '#e6f0f5', .8) +
    circle(-4, -3, 1.8, '#d8a071'),

  // Street light and a security camera.
  M10: () => ground('#d7e8ec') +
    p('7,-28 -4,-4 17,-7', '#f4e7ad', 'opacity=".38"') +
    ellipse(-4, -.8, 3.8, 1.5, '#789fb1') +
    path('M-4,-1V-32Q-4,-35 -1,-35H8', '#5b839c', 2.8) +
    p('4,-37 12,-35 10,-31 2,-33', '#8db6c9') +
    p('2,-33 10,-31 9,-29 3,-30', '#fff0b9') +
    path('M-3,-21H5', '#5b839c', 1.8) +
    p('2,-24 8,-26 15,-23 9,-21', '#e7f3fa') +
    p('2,-24 9,-21 9,-17 2,-20', '#abcddd') +
    p('9,-21 15,-23 15,-19 9,-17', '#406e8b') +
    ellipse(12, -20, 1.3, 1.5, '#244c67'),

  // Raised zebra crossing with a pedestrian sign.
  M11: () => ground('#bdd3de') +
    p('-20,-5 0,-13 20,-5 0,3', '#89adbe') +
    p('-16,-5 -12,-7 5,0 1,2', '#f0f7fb') +
    p('-10,-7.5 -6,-9.5 11,-2.5 7,-.5', '#f0f7fb') +
    p('-4,-10 0,-12 17,-5 13,-3', '#f0f7fb') +
    path('M-12,-4V-26', '#5d869d', 2) +
    p('-17,-33 -8,-29 -8,-20 -17,-24', '#4d8ab3') +
    p('-15,-30 -10,-27.8 -10,-22.8 -15,-25', '#f2f8fc') +
    circle(-12.5, -27, .75, '#477c9d') +
    path('M-12.5,-26L-13,-24.7 M-14,-25.6L-11.3,-24.5 M-13,-24.7L-14,-23.5 M-13,-24.7L-11.7,-23', '#477c9d', .6) +
    path('M12,-7V-12', '#c8b076', 1.8) + circle(12, -12.2, 1.5, '#ead797'),

  // Civic services touchscreen kiosk and a small canopy.
  M12: () => ground('#d4e6f0') +
    box(0, 0, 9, 10, 26, '#e8f4fb', '#a2cde0', '#5e9abc') +
    p('-12,-30 1,-36 14,-30 1,-24', '#efd591') +
    p('-12,-30 1,-24 1,-21 -12,-27', '#d8b664') +
    p('1,-24 14,-30 14,-27 1,-21', '#b89545') +
    p('2,-21 8,-24 8,-12 2,-9', '#285d80') +
    path('M3.3,-18.5L6.7,-20 M3.3,-15.5L6.7,-17', '#d5edf8', 1) +
    circle(5, -12.5, 1, '#b4ddbd') +
    p('2,-6 7,-8.5 7,-6.5 2,-4', '#e1edf4') +
    p('-6,-23 -3,-21.5 -3,-18.5 -6,-20', '#d0e7f2'),

  // Exposed new water and heating mains with a valve wheel.
  M13: () => ground('#d4cfb5') +
    p('-17,-5 0,-12 17,-5 0,2', '#a5c1cf') +
    path('M-16,-5L-4,0 13,-8V-20', '#5a9dc2', 5.5) +
    path('M-16,-6L-4,-1 12,-8V-20', '#aad8ea', 2) +
    path('M-11,-11L3,-5 17,-11', '#bd8f6e', 4.5) +
    path('M-11,-12L3,-6 17,-12', '#e1ba8a', 1.4) +
    ellipse(13, -20, 2.8, 1.3, '#d9eaf2') +
    ellipse(13, -20, 1.5, .7, '#477e9d') +
    path('M3,-6V-18', '#a4785b', 2) +
    ellipse(3, -19, 5, 2.5, 'none', 'stroke="#aa7860" stroke-width="1.7"') +
    path('M-1,-20L7,-18 M-1,-18L7,-20', '#aa7860', 1) +
    ellipse(-16, -5.5, 2, 2.6, '#c5e0ea') +
    ellipse(-16, -5.5, 1, 1.5, '#4b819d'),

  // Utility service van with amber beacon and tool emblem.
  M14: () => ground('#c7dce6') +
    p('-17,-18 1,-26 16,-19 -2,-11', '#f3db99') +
    p('-17,-18 -2,-11 -2,-2 -17,-9', '#6eaccf') +
    p('-2,-11 16,-19 16,-10 -2,-2', '#8cc6e1') +
    p('-15,-17 -4,-12 -4,-7 -15,-12', '#78b6d6') +
    p('0,-11 5,-13.2 5,-9 0,-6.8', '#346985') +
    path('M7,-14V-6', '#649abb', 1) +
    path('M-1,-4L15,-11', '#efd28b', 1.1) +
    ellipse(1, -2.8, 2, 2.4, '#31536a') +
    ellipse(12, -7.8, 2, 2.4, '#31536a') +
    circle(1, -2.8, .8, '#d5e1e7') + circle(12, -7.8, .8, '#d5e1e7') +
    path('M10,-9.5L13,-14', '#f8f0d7', 1.5) +
    path('M12,-14L12,-15 14,-16 14.5,-14.5 13,-13.5', '#f8f0d7', 1.2) +
    box(-1, -24, 3, 3, 2.5, '#f5ce83', '#e1af62', '#c99653') +
    p('-16,-10 -13,-8.5 -13,-7 -16,-8.5', '#fff0be'),
};

/** SVG contents only; caller owns positioning, accessible text and animation. */
export function renderMapObject(measureId) {
  const illustration = Object.hasOwn(illustrations, measureId) ? illustrations[measureId] : null;
  return illustration
    ? `<g stroke-linecap="round" stroke-linejoin="round">${illustration()}</g>`
    : '';
}
