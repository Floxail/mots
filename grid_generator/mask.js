var LETTER = 'L';
var DEF = 'D';

// Arrow types: where the word starts relative to the def cell, and its axis.
// R : starts right, runs right (H)   RB: starts right, runs down (V, bent)
// B : starts below, runs down  (V)   BR: starts below, runs right (H, bent)
// The four double-arrow combinations real GSO grids use, per gridManager.js's
// placeArrows character table (e-i, j-n, o-s, t-x - derived empirically over
// 51 real provider grids). There is no character encoding B+BR, so that pair
// is not observed and is deliberately absent here.
var ARROW_PAIRS = [['R', 'B'], ['RB', 'B'], ['R', 'BR'], ['RB', 'BR']];

function mulberry32(seed) {
  var state = seed;
  return function () {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    var t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function arrowAxis(arrow) {
  return (arrow === 'R' || arrow === 'BR') ? 'H' : 'V';
}

// index of the word's first cell for an arrow on def cell idx, or -1 if off-grid
function arrowStart(mask, idx, arrow) {
  var col = idx % mask.nbLines;
  var row = (idx - col) / mask.nbLines;
  if (arrow === 'R' || arrow === 'RB') return col + 1 < mask.nbLines ? idx + 1 : -1;
  return row + 1 < mask.nbColumns ? idx + mask.nbLines : -1;
}

function walkWord(mask, start, axis) {
  var cells = [];
  if (start === -1) return cells;
  var col = start % mask.nbLines;
  var row = (start - col) / mask.nbLines;
  while (row < mask.nbColumns && col < mask.nbLines &&
         mask.cells[row * mask.nbLines + col].kind === LETTER) {
    cells.push(row * mask.nbLines + col);
    if (axis === 'H') col++; else row++;
  }
  return cells;
}

function deriveWords(mask) {
  var words = [];
  mask.cells.forEach(function (cell, idx) {
    if (cell.kind !== DEF) return;
    cell.arrows.forEach(function (arrow, arrowIndex) {
      var axis = arrowAxis(arrow);
      words.push({
        axis: axis,
        cells: walkWord(mask, arrowStart(mask, idx, arrow), axis),
        defCell: idx,
        arrowIndex: arrowIndex,
        arrow: arrow
      });
    });
  });
  return words;
}

var DEFAULT_WEIGHTS = {
  uncovered: 1500,
  singleCovered: 200,
  singleCoveredEnclosed: 75,
  overlap: 600,
  // index = word length; length 0 = arrow pointing off-grid/at-a-Def
  // Retuned against 51 real GSO grids: 2-16, 3-17, 4-21, 5-15, 6-10, 7-4, 8-5,
  // 9-7, 10-5 percent of words, so lengths 2-6 are all ordinary and only the
  // extremes deserve real cost. Engel's original table (tuned on German
  // Schwedenraetsel) charged 650 for a 2-letter word, nearly a veto here.
  wordLength: [2000, 1500, 60, 20, 0, 0, 10, 40, 50, 60, 80, 180, 300, 450, 650, 900],
  wordLengthBeyond: 300,
  unenclosedStart: 2000,
  deadEnd: 400,
  // Retuned against 51 real GSO grids: definition clusters never exceed 3
  // cells, so the table now stops describing 4-7 as merely expensive and
  // charges them like the outliers they are.
  clusterBase: [0, 0, 60, 260, 900, 1600, 2400, 3400],
  clusterBeyond: 400,
  longCrossLen: 6,
  uncluedRun: 1500,
  // Retuned against 51 real GSO grids (see defRunPenalty): vertical runs of
  // adjacent definition cells are always length 1, horizontal runs reach 2
  // only 6% of the time and never 3. The previous barème had no term for
  // this at all, which is how the first generated 15x15 got a column of
  // seven stacked definitions - the "band of definitions" defect. Started
  // at 900 (quadratic excess, so it dominates fast); at 15x15/maxStale=60000
  // that collapsed convergence to ~1/15 valid masks (vs ~4/15 pre-retune),
  // so softened to 500, which recovered convergence to ~3/15 while a real
  // generated 15x15 still met every structural target (H2 V2, cluster 3,
  // density 23% - see task-11-report.md Step 5/7).
  defRunH: 500,
  defRunV: 500
};

function clusterPenalty(mask, w) {
  var total = 0;
  var visited = new Array(mask.cells.length).fill(false);
  for (var i = 0; i < mask.cells.length; i++) {
    if (visited[i] || mask.cells[i].kind !== DEF) continue;
    var queue = [i];
    visited[i] = true;
    var members = [];
    while (queue.length) {
      var idx = queue.pop();
      members.push(idx);
      var col = idx % mask.nbLines, row = (idx - col) / mask.nbLines;
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          var r = row + dr, c = col + dc;
          if (r < 0 || c < 0 || r >= mask.nbColumns || c >= mask.nbLines) continue;
          var n = r * mask.nbLines + c;
          if (!visited[n] && mask.cells[n].kind === DEF) { visited[n] = true; queue.push(n); }
        }
      }
    }
    // border (row 0 / col 0) def cells count half - clusters there are unavoidable
    var effSize = 0, minR = Infinity, maxR = -1, minC = Infinity, maxC = -1;
    members.forEach(function (idx) {
      var col = idx % mask.nbLines, row = (idx - col) / mask.nbLines;
      effSize += (row === 0 || col === 0) ? 0.5 : 1;
      if (row < minR) minR = row;
      if (row > maxR) maxR = row;
      if (col < minC) minC = col;
      if (col > maxC) maxC = col;
    });
    var s = Math.round(effSize);
    var ext = Math.max(maxR - minR + 1, maxC - minC + 1);
    var base = s < w.clusterBase.length
      ? w.clusterBase[s]
      : w.clusterBase[w.clusterBase.length - 1] + w.clusterBeyond * (s - w.clusterBase.length + 1);
    total += Math.round(base * (0.75 + 0.25 * ext / Math.max(s, 1)));
  }
  return total;
}

// Measured over 51 real GSO grids: every vertical run of adjacent definition
// cells is length 1, and horizontal runs reach 2 only 6% of the time and
// never 3. The 8-connected cluster term alone does not express this - it
// charges a diagonal scatter and a straight bar about the same - so a
// straight stack of definitions was cheap enough for the optimizer to buy.
// That stack is what reads as a "band of definitions" down one side.
// Cost grows quadratically past the length real grids tolerate.
function defRunPenalty(mask, w) {
  var total = 0;

  function chargeRun(len, allowed, weight) {
    if (len <= allowed) return 0;
    var excess = len - allowed;
    return weight * excess * excess;
  }

  for (var row = 0; row < mask.nbColumns; row++) {
    var run = 0;
    for (var col = 0; col < mask.nbLines; col++) {
      if (mask.cells[row * mask.nbLines + col].kind === DEF) run++;
      else { total += chargeRun(run, 2, w.defRunH); run = 0; }
    }
    total += chargeRun(run, 2, w.defRunH);
  }

  for (var col2 = 0; col2 < mask.nbLines; col2++) {
    var run2 = 0;
    for (var row2 = 0; row2 < mask.nbColumns; row2++) {
      if (mask.cells[row2 * mask.nbLines + col2].kind === DEF) run2++;
      else { total += chargeRun(run2, 1, w.defRunV); run2 = 0; }
    }
    total += chargeRun(run2, 1, w.defRunV);
  }

  return total;
}

// Every maximal run of 2+ letter cells must be exactly one clued word: the
// player reads any such run as a word, so a run no arrow points at is
// unsolvable even when each of its cells is covered by the perpendicular
// axis. validateGrid enforces this on the finished grid; scoring and
// deriveSlots have to agree with it or the hillclimber optimizes toward
// masks the validator will reject.
function scanRuns(mask, axis) {
  var runs = [];
  var outerCount = axis === 'H' ? mask.nbColumns : mask.nbLines;
  var innerCount = axis === 'H' ? mask.nbLines : mask.nbColumns;
  for (var outer = 0; outer < outerCount; outer++) {
    var run = [];
    for (var inner = 0; inner < innerCount; inner++) {
      var idx = axis === 'H' ? outer * mask.nbLines + inner : inner * mask.nbLines + outer;
      if (mask.cells[idx].kind === LETTER) run.push(idx);
      else if (run.length) { runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);
  }
  return runs;
}

function uncluedRunPenalty(mask, words, w) {
  var clued = { H: new Set(), V: new Set() };
  words.forEach(function (word) {
    if (word.cells.length >= 2) clued[word.axis].add(word.cells.join(','));
  });
  var total = 0;
  ['H', 'V'].forEach(function (axis) {
    scanRuns(mask, axis).forEach(function (run) {
      if (run.length >= 2 && !clued[axis].has(run.join(','))) total += w.uncluedRun;
    });
  });
  return total;
}

function deriveSlots(mask) {
  var words = deriveWords(mask);
  var slots = [];
  for (var i = 0; i < words.length; i++) {
    if (words[i].cells.length < 2) return null;
    slots.push({
      axis: words[i].axis, cells: words[i].cells, length: words[i].cells.length,
      crossings: [], defCell: words[i].defCell, arrowIndex: words[i].arrowIndex
    });
  }

  var hOwner = new Map(), vOwner = new Map();
  for (var s = 0; s < slots.length; s++) {
    var owner = slots[s].axis === 'H' ? hOwner : vOwner;
    for (var p = 0; p < slots[s].cells.length; p++) {
      if (owner.has(slots[s].cells[p])) return null;
      owner.set(slots[s].cells[p], { slotIndex: s, pos: p });
    }
  }

  for (var i = 0; i < mask.cells.length; i++) {
    if (mask.cells[i].kind === LETTER && !hOwner.has(i) && !vOwner.has(i)) return null;
  }

  var clued = { H: new Set(), V: new Set() };
  slots.forEach(function (slot) { clued[slot.axis].add(slot.cells.join(',')); });
  var axes = ['H', 'V'];
  for (var a = 0; a < axes.length; a++) {
    var runs = scanRuns(mask, axes[a]);
    for (var r = 0; r < runs.length; r++) {
      if (runs[r].length >= 2 && !clued[axes[a]].has(runs[r].join(','))) return null;
    }
  }

  slots.forEach(function (slot) {
    var other = slot.axis === 'H' ? vOwner : hOwner;
    slot.cells.forEach(function (cellIndex, pos) {
      var hit = other.get(cellIndex);
      if (hit) slot.crossings.push({ slotIndex: hit.slotIndex, ownPos: pos, otherPos: hit.pos });
    });
  });
  return slots;
}

function scoreMask(mask, weights) {
  // Object.assign so a partial weights object (the barème is deliberately
  // injectable - see spec section 12) fills in from the default instead of
  // silently producing NaN for whatever key it omitted.
  var w = Object.assign({}, DEFAULT_WEIGHTS, weights);
  var total = 0;
  var words = deriveWords(mask);
  var size = mask.cells.length;
  var hCov = new Array(size).fill(0);
  var vCov = new Array(size).fill(0);
  var hLen = new Array(size).fill(0);
  var vLen = new Array(size).fill(0);

  words.forEach(function (word) {
    var len = word.cells.length;
    total += len < w.wordLength.length
      ? w.wordLength[len]
      : w.wordLength[w.wordLength.length - 1] + w.wordLengthBeyond * (len - w.wordLength.length + 1);

    word.cells.forEach(function (idx) {
      if (word.axis === 'H') { hCov[idx]++; hLen[idx] = len; }
      else { vCov[idx]++; vLen[idx] = len; }
    });

    // a bent word starting right after a Letter would render as one continuous
    // run the player cannot split - penalize the unenclosed start
    if (len > 0 && (word.arrow === 'RB' || word.arrow === 'BR')) {
      var start = word.cells[0];
      var col = start % mask.nbLines, row = (start - col) / mask.nbLines;
      var pred = word.arrow === 'RB'
        ? (row > 0 ? start - mask.nbLines : -1)
        : (col > 0 ? start - 1 : -1);
      if (pred !== -1 && mask.cells[pred].kind === LETTER) total += w.unenclosedStart;
    }
  });

  mask.cells.forEach(function (cell, idx) {
    if (cell.kind !== LETTER) return;
    var col = idx % mask.nbLines, row = (idx - col) / mask.nbLines;

    if (hCov[idx] > 1 || vCov[idx] > 1) total += w.overlap;
    else if (hCov[idx] + vCov[idx] === 0) total += w.uncovered;
    else if (hCov[idx] + vCov[idx] === 1) {
      var prev, next;
      if (hCov[idx] === 1) {
        prev = row > 0 ? mask.cells[idx - mask.nbLines] : null;
        next = row + 1 < mask.nbColumns ? mask.cells[idx + mask.nbLines] : null;
      } else {
        prev = col > 0 ? mask.cells[idx - 1] : null;
        next = col + 1 < mask.nbLines ? mask.cells[idx + 1] : null;
      }
      var enclosed = (!prev || prev.kind !== LETTER) && (!next || next.kind !== LETTER);
      total += enclosed ? w.singleCoveredEnclosed : w.singleCovered;
    }

    if (hLen[idx] > w.longCrossLen && vLen[idx] > w.longCrossLen) total += hLen[idx] * vLen[idx];

    // dead end: 3 of 4 neighbors non-letter (off-grid counts), except top/left border
    if (row > 0 && col > 0) {
      var nonLetter = 0;
      if (mask.cells[idx - mask.nbLines].kind !== LETTER) nonLetter++;
      if (row + 1 >= mask.nbColumns || mask.cells[idx + mask.nbLines].kind !== LETTER) nonLetter++;
      if (mask.cells[idx - 1].kind !== LETTER) nonLetter++;
      if (col + 1 >= mask.nbLines || mask.cells[idx + 1].kind !== LETTER) nonLetter++;
      if (nonLetter === 3) total += w.deadEnd;
    }
  });

  return total + clusterPenalty(mask, w) + uncluedRunPenalty(mask, words, w) + defRunPenalty(mask, w);
}

// Engel 2009 section 3.4: a typical mask is about two thirds letter fields,
// and among definitions the straight single arrows occur far more often than
// the bent ones. Drawing uniformly over every arrow option (as this used to)
// produces far too many double-definition cells, which are the hardest kind
// to satisfy.
function randomCellKind(rng) {
  var roll = rng();
  if (roll < 0.66) return { kind: LETTER };
  if (roll < 0.755) return { kind: DEF, arrows: ['R'] };
  if (roll < 0.85) return { kind: DEF, arrows: ['B'] };
  if (roll < 0.895) return { kind: DEF, arrows: ['RB'] };
  if (roll < 0.94) return { kind: DEF, arrows: ['BR'] };
  return { kind: DEF, arrows: ARROW_PAIRS[Math.floor(rng() * ARROW_PAIRS.length)].slice() };
}

// Box-Muller, so the spread around the central point is a real normal draw.
function gaussian(rng, sigma) {
  var u = 1 - rng();
  var v = rng();
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Engel 2009 section 3.4 measured mutation size: k=1 was the worst setting he
// tested and k drawn from {2,3} the best. Escaping a local optimum in a mask
// normally takes two or three coordinated changes - a single flip cannot make
// one, which is exactly the stall this generator hit. The cells are drawn
// close together (sigma ~ 3) because two distant changes are uncorrelated,
// and an uncorrelated pair is far likelier to hurt than to help.
function pickMutationCells(mask, rng) {
  var k = rng() < 0.5 ? 2 : 3;
  var size = mask.cells.length;
  var centre = Math.floor(rng() * size);
  var centreCol = centre % mask.nbLines;
  var centreRow = (centre - centreCol) / mask.nbLines;
  var picked = [centre];
  var guard = 0;

  while (picked.length < k && guard++ < 50) {
    var col = Math.round(centreCol + gaussian(rng, 3));
    var row = Math.round(centreRow + gaussian(rng, 3));
    if (col < 0 || row < 0 || col >= mask.nbLines || row >= mask.nbColumns) continue;
    var idx = row * mask.nbLines + col;
    if (picked.indexOf(idx) === -1) picked.push(idx);
  }
  return picked;
}

function generateMask(nbLines, nbColumns, rng, options) {
  options = options || {};
  var w = Object.assign({}, DEFAULT_WEIGHTS, options.weights);
  var maxStale = options.maxStale !== undefined ? options.maxStale : 60000;
  var maxIterations = options.maxIterations !== undefined ? options.maxIterations : 500000;

  var cells = [];
  for (var i = 0; i < nbLines * nbColumns; i++) cells.push(randomCellKind(rng));
  var mask = { cells: cells, nbLines: nbLines, nbColumns: nbColumns };
  // ponytail: full rescore per mutation (~tens of us on 15x15); go incremental
  // (rescore only words/clusters touching the mutated cell) if the benchmark
  // test ever pushes a full hillclimb past ~30s
  var penalty = scoreMask(mask, w);

  var stale = 0;
  for (var iter = 0; iter < maxIterations && stale < maxStale; iter++) {
    var targets = pickMutationCells(mask, rng);
    var saved = targets.map(function (idx) { return cells[idx]; });
    targets.forEach(function (idx) { cells[idx] = randomCellKind(rng); });

    var next = scoreMask(mask, w);
    if (next < penalty) { penalty = next; stale = 0; }
    else if (next === penalty) { stale++; }  // plateau move: keep it, still count toward the break
    else {
      targets.forEach(function (idx, n) { cells[idx] = saved[n]; });
      stale++;
    }
  }

  mask.penalty = penalty;
  return mask;
}

module.exports = {
  deriveWords: deriveWords,
  deriveSlots: deriveSlots,
  mulberry32: mulberry32,
  DEFAULT_WEIGHTS: DEFAULT_WEIGHTS,
  scoreMask: scoreMask,
  randomCellKind: randomCellKind,
  pickMutationCells: pickMutationCells,
  generateMask: generateMask
};
