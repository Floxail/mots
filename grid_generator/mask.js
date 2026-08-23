var LETTER = 'L';
var DEF = 'D';

// Arrow types: where the word starts relative to the def cell, and its axis.
// R : starts right, runs right (H)   RB: starts right, runs down (V, bent)
// B : starts below, runs down  (V)   BR: starts below, runs right (H, bent)
var ARROWS = ['R', 'RB', 'B', 'BR'];
// Pair combinations observed in real GSO grids
var ARROW_PAIRS = [['R', 'B'], ['RB', 'B'], ['R', 'BR'], ['B', 'BR'], ['RB', 'BR']];

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
  wordLength: [2000, 1500, 650, 100, 10, 0, 0, 30, 50, 150, 250, 400, 550, 750, 1000, 1300],
  wordLengthBeyond: 300,
  unenclosedStart: 2000,
  deadEnd: 400,
  clusterBase: [0, 0, 150, 320, 670, 980, 1300, 2000],
  clusterBeyond: 400,
  longCrossLen: 6,
  uncluedRun: 1500
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
  var w = weights || DEFAULT_WEIGHTS;
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

  return total + clusterPenalty(mask, w) + uncluedRunPenalty(mask, words, w);
}

function randomArrows(rng) {
  var pick = Math.floor(rng() * (ARROWS.length + ARROW_PAIRS.length));
  if (pick < ARROWS.length) return [ARROWS[pick]];
  return ARROW_PAIRS[pick - ARROWS.length].slice();
}

function generateMask(nbLines, nbColumns, rng, options) {
  options = options || {};
  var w = options.weights || DEFAULT_WEIGHTS;
  var defRatio = options.defRatio !== undefined ? options.defRatio : 0.2;
  var maxStale = options.maxStale !== undefined ? options.maxStale : 5000;
  var maxIterations = options.maxIterations !== undefined ? options.maxIterations : 500000;

  var cells = [];
  for (var i = 0; i < nbLines * nbColumns; i++) {
    cells.push(rng() < defRatio ? { kind: DEF, arrows: randomArrows(rng) } : { kind: LETTER });
  }
  var mask = { cells: cells, nbLines: nbLines, nbColumns: nbColumns };
  // ponytail: full rescore per mutation (~tens of us on 15x15); go incremental
  // (rescore only words/clusters touching the mutated cell) if the benchmark
  // test ever pushes a full hillclimb past ~30s
  var penalty = scoreMask(mask, w);

  var stale = 0;
  for (var iter = 0; iter < maxIterations && stale < maxStale; iter++) {
    var idx = Math.floor(rng() * cells.length);
    var saved = cells[idx];
    if (saved.kind === LETTER) cells[idx] = { kind: DEF, arrows: randomArrows(rng) };
    else if (rng() < 0.5) cells[idx] = { kind: LETTER };
    else cells[idx] = { kind: DEF, arrows: randomArrows(rng) };

    var next = scoreMask(mask, w);
    if (next < penalty) { penalty = next; stale = 0; }
    else if (next === penalty) { stale++; }  // plateau move: keep it, still count toward the break
    else { cells[idx] = saved; stale++; }
  }

  mask.penalty = penalty;
  return mask;
}

module.exports = {
  LETTER: LETTER,
  DEF: DEF,
  ARROWS: ARROWS,
  ARROW_PAIRS: ARROW_PAIRS,
  arrowAxis: arrowAxis,
  deriveWords: deriveWords,
  deriveSlots: deriveSlots,
  mulberry32: mulberry32,
  DEFAULT_WEIGHTS: DEFAULT_WEIGHTS,
  scoreMask: scoreMask,
  generateMask: generateMask
};
