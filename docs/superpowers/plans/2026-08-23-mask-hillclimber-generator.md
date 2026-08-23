# Mask-Hillclimber Grid Generator v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the whole grid generator with: penalty-driven hillclimber mask generation (Engel 2009), arrow-defined words (incl. GSO bent arrows), MRV + forward-checking fill.

**Architecture:** `mask.js` (genome + scoring + hillclimber + slot derivation) → `fill.js` (backtracking solver) → `export.js` (game-grid JSON) → `validate.js` (final safety net), orchestrated by `scripts/generate-grid.js`. Old skeleton/backtracking/exporter/slots modules deleted at the end.

**Tech Stack:** Plain Node.js (CommonJS, `var`-style matching the codebase), `node:test` + `node:assert`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-23-mask-hillclimber-generator-design.md` — read it first, it defines the model (arrows R/RB/B/BR, penalty tables, validity rules).

## Global Constraints

- Package manager: **pnpm** (`pnpm test`), never npm.
- Branch: `feature/grid-generator`. Commit + push after each task is allowed and expected (standing user permission).
- Grid indexing convention (whole codebase): flat array, `idx = row * nbLines + col`; **`nbLines` = width (stride), `nbColumns` = height**.
- Arrow export codes (client contract, `public/javascripts/game/grid.js`): `0=Right, 1=RightBottom(bent), 2=Bottom, 3=BottomRight(bent)` — gridManager's local enum, NOT `enums.ArrowDirections`.
- New code style: match existing `grid_generator/` files (`var`, function declarations, `module.exports` at bottom).
- Until Task 7, do NOT modify or delete any existing file — new files only (`mask.js`, `fill.js`, `export.js` and their tests). The old pipeline keeps passing `pnpm test` throughout.

---

### Task 1: mask.js — genome model and word derivation

**Files:**
- Create: `grid_generator/mask.js`
- Create: `test/mask.test.js`

**Interfaces:**
- Produces (used by every later task):
  - Mask object: `{ cells: Array<{kind:'L'} | {kind:'D', arrows: string[]}>, nbLines, nbColumns }`
  - `ARROWS = ['R','RB','B','BR']`, `ARROW_PAIRS = [['R','B'],['RB','B'],['R','BR'],['B','BR'],['RB','BR']]`
  - `arrowAxis(arrow) -> 'H'|'V'`
  - `deriveWords(mask) -> [{ axis, cells: number[], defCell, arrowIndex, arrow }]` (cells may be empty for an invalid arrow)
  - `mulberry32(seed) -> () => float` (moved here as single source; same implementation as in `scripts/generate-grid.js`)

- [ ] **Step 1: Write failing tests**

```js
// test/mask.test.js
var test = require('node:test');
var assert = require('node:assert');
var mask = require('../grid_generator/mask');

function L() { return { kind: 'L' }; }
function D() { return { kind: 'D', arrows: Array.prototype.slice.call(arguments) }; }
function M(nbLines, nbColumns, cells) { return { cells: cells, nbLines: nbLines, nbColumns: nbColumns }; }

test('deriveWords: straight R arrow walks right until non-letter', function () {
  var m = M(3, 1, [D('R'), L(), L()]);
  var words = mask.deriveWords(m);
  assert.strictEqual(words.length, 1);
  assert.deepStrictEqual(words[0], { axis: 'H', cells: [1, 2], defCell: 0, arrowIndex: 0, arrow: 'R' });
});

test('deriveWords: bent RB starts right of the def and runs down', function () {
  // 2x2: D at (0,0), everything else Letter
  var m = M(2, 2, [D('RB'), L(), L(), L()]);
  var words = mask.deriveWords(m);
  assert.strictEqual(words[0].axis, 'V');
  assert.deepStrictEqual(words[0].cells, [1, 3]);
});

test('deriveWords: bent BR starts below the def and runs right', function () {
  var m = M(2, 2, [D('BR'), L(), L(), L()]);
  assert.strictEqual(mask.deriveWords(m)[0].axis, 'H');
  assert.deepStrictEqual(mask.deriveWords(m)[0].cells, [2, 3]);
});

test('deriveWords: B arrow runs down from below the def', function () {
  var m = M(2, 2, [D('B'), L(), L(), L()]);
  assert.strictEqual(mask.deriveWords(m)[0].axis, 'V');
  assert.deepStrictEqual(mask.deriveWords(m)[0].cells, [2]);
});

test('deriveWords: arrow pointing off-grid yields an empty word', function () {
  var m = M(1, 1, [D('R')]);
  assert.deepStrictEqual(mask.deriveWords(m)[0].cells, []);
});

test('deriveWords: word stops at a Description cell', function () {
  var m = M(4, 1, [D('R'), L(), D('R'), L()]);
  var words = mask.deriveWords(m);
  assert.deepStrictEqual(words[0].cells, [1]);
  assert.deepStrictEqual(words[1].cells, [3]);
});

test('deriveWords: horizontal walk never wraps to the next row', function () {
  // D at end of row 0 pointing R -> off-grid; letters on row 1 must not be picked up
  var m = M(2, 2, [L(), D('R'), L(), L()]);
  var words = mask.deriveWords(m);
  assert.deepStrictEqual(words[0].cells, []);
});

test('deriveWords: a double def cell yields two words in arrow order', function () {
  var m = M(2, 2, [D('R', 'B'), L(), L(), L()]);
  var words = mask.deriveWords(m);
  assert.strictEqual(words.length, 2);
  assert.strictEqual(words[0].arrowIndex, 0);
  assert.strictEqual(words[0].arrow, 'R');
  assert.strictEqual(words[1].arrow, 'B');
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test 2>&1 | grep -A2 mask` (or `node --test test/mask.test.js`)
Expected: FAIL — cannot find module '../grid_generator/mask'

- [ ] **Step 3: Implement**

```js
// grid_generator/mask.js
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

module.exports = {
  LETTER: LETTER,
  DEF: DEF,
  ARROWS: ARROWS,
  ARROW_PAIRS: ARROW_PAIRS,
  arrowAxis: arrowAxis,
  deriveWords: deriveWords,
  mulberry32: mulberry32
};
```

- [ ] **Step 4: Run tests, verify pass; run full suite**

Run: `pnpm test`
Expected: all pass (new + all pre-existing).

- [ ] **Step 5: Commit**

```bash
git add grid_generator/mask.js test/mask.test.js
git commit -m "feat: mask genome model with arrow-derived words (incl. GSO bent arrows)"
```

---

### Task 2: mask.js — penalty scoring

**Files:**
- Modify: `grid_generator/mask.js` (add scoring)
- Modify: `test/mask.test.js` (add tests)

**Interfaces:**
- Produces:
  - `DEFAULT_WEIGHTS` object (shape below — every later consumer passes weights through untouched)
  - `scoreMask(mask, weights?) -> number` (total penalty, full recompute)

- [ ] **Step 1: Write failing tests** — each penalty isolated via a zeroed-weights helper:

```js
// append to test/mask.test.js
function zeroWeights() {
  return {
    uncovered: 0, singleCovered: 0, singleCoveredEnclosed: 0, overlap: 0,
    wordLength: new Array(16).fill(0), wordLengthBeyond: 0,
    unenclosedStart: 0, deadEnd: 0,
    clusterBase: new Array(8).fill(0), clusterBeyond: 0,
    longCrossLen: 6
  };
}

test('scoreMask: uncovered letters', function () {
  var w = zeroWeights(); w.uncovered = 1500;
  assert.strictEqual(mask.scoreMask(M(2, 1, [L(), L()]), w), 3000);
});

test('scoreMask: crossed cell costs 0, single-covered enclosed costs the enclosed rate', function () {
  var w = zeroWeights(); w.singleCoveredEnclosed = 75; w.singleCovered = 200;
  // D(RB,BR) at (0,0): V word [1,3], H word [2,3]. Cell 3 crossed (0),
  // cells 1 and 2 single-covered with non-letter perpendicular neighbors (75 each).
  var m = M(2, 2, [D('RB', 'BR'), L(), L(), L()]);
  assert.strictEqual(mask.scoreMask(m, w), 150);
});

test('scoreMask: single-covered with a letter perpendicular neighbor costs the full rate', function () {
  var w = zeroWeights(); w.singleCovered = 200; w.singleCoveredEnclosed = 75;
  // 3x2: H word [1,2] on row 0; row 1 all letters (uncovered, zero-weighted here).
  // Cells 1,2 have letter neighbors below -> NOT enclosed -> 200 each.
  var m = M(3, 2, [D('R'), L(), L(), L(), L(), L()]);
  assert.strictEqual(mask.scoreMask(m, w), 400);
});

test('scoreMask: same-axis overlap', function () {
  var w = zeroWeights(); w.overlap = 600;
  // Two BR words on row 1 overlapping on cells 5,6,7 (word A [4..7], word B [5..7])
  var m = M(4, 2, [D('BR'), D('BR'), L(), L(), L(), L(), L(), L()]);
  assert.strictEqual(mask.scoreMask(m, w), 1800);
});

test('scoreMask: bent arrow starting after a letter (unenclosed start)', function () {
  var w = zeroWeights(); w.unenclosedStart = 2000;
  var m = M(4, 2, [D('BR'), D('BR'), L(), L(), L(), L(), L(), L()]);
  // word B starts at cell 5 whose left neighbor (cell 4) is a Letter
  assert.strictEqual(mask.scoreMask(m, w), 2000);
});

test('scoreMask: word length table and beyond-table extrapolation', function () {
  var w = zeroWeights(); w.wordLength[2] = 650;
  assert.strictEqual(mask.scoreMask(M(3, 1, [D('R'), L(), L()]), w), 650);

  var w2 = zeroWeights(); w2.wordLength[15] = 1300; w2.wordLengthBeyond = 300;
  var cells = [D('R')];
  for (var i = 0; i < 17; i++) cells.push(L());
  assert.strictEqual(mask.scoreMask(M(18, 1, cells), w2), 1300 + 300 * 2); // len 17
});

test('scoreMask: crossing of two long words costs lenH*lenV', function () {
  var w = zeroWeights();
  var cells = [];
  for (var i = 0; i < 64; i++) cells.push(L());
  cells[3 * 8 + 0] = D('R'); // H word row 3, cols 1..7, len 7
  cells[0 * 8 + 4] = D('B'); // V word col 4, rows 1..7, len 7
  assert.strictEqual(mask.scoreMask(M(8, 8, cells), w), 49);
});

test('scoreMask: dead ends (3 non-letter neighbors, top/left border excluded)', function () {
  var w = zeroWeights(); w.deadEnd = 400;
  // (1,1) and (2,1) each have exactly 3 non-letter neighbors
  var m = M(3, 3, [D('B'), D('B'), D('B'),
                   D('B'), L(),    D('B'),
                   D('B'), L(),    D('B')]);
  assert.strictEqual(mask.scoreMask(m, w), 800);
});

test('scoreMask: def cluster penalty, interior block', function () {
  var w = zeroWeights(); w.clusterBase = [0, 0, 150, 320, 670, 980, 1300, 2000];
  // 4-cell D block at rows 1-2, cols 1-2 of a 3x3: size 4, extension 2
  var m = M(3, 3, [L(), L(), L(),
                   L(), D('R'), D('R'),
                   L(), D('R'), D('R')]);
  // round(670 * (0.75 + 0.25 * 2/4)) = 586
  assert.strictEqual(mask.scoreMask(m, w), 586);
});

test('scoreMask: border def cells count half toward cluster size', function () {
  var w = zeroWeights(); w.clusterBase = [0, 0, 150, 320, 670, 980, 1300, 2000];
  // block at rows 0-1, cols 0-1: three border cells (0.5 each) + one interior
  // effective size 2.5 -> round 3, ext 2 -> round(320 * (0.75 + 0.25*2/3)) = 293
  var m = M(3, 3, [D('R'), D('R'), L(),
                   D('R'), D('R'), L(),
                   L(), L(), L()]);
  assert.strictEqual(mask.scoreMask(m, w), 293);
});
```

- [ ] **Step 2: Run, verify FAIL** (`scoreMask` not exported)

- [ ] **Step 3: Implement** — add to `grid_generator/mask.js`:

```js
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
  longCrossLen: 6
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

  return total + clusterPenalty(mask, w);
}
```

Add `DEFAULT_WEIGHTS: DEFAULT_WEIGHTS, scoreMask: scoreMask` to `module.exports`.

- [ ] **Step 4: Run `pnpm test`, all pass.** If a cluster/coverage expectation is off by a few points, re-derive the arithmetic by hand before touching the implementation — the tests encode the spec's tables.

- [ ] **Step 5: Commit** — `git commit -m "feat: mask penalty scoring (coverage, lengths, clusters, dead ends)"`

---

### Task 3: mask.js — deriveSlots

**Files:**
- Modify: `grid_generator/mask.js`
- Modify: `test/mask.test.js`

**Interfaces:**
- Produces: `deriveSlots(mask) -> slots[] | null` where each slot is
  `{ axis: 'H'|'V', cells: number[], length, crossings: [{slotIndex, ownPos, otherPos}], defCell, arrowIndex }`.
  Returns `null` when the mask is invalid: any word shorter than 2, same-axis overlap, or any Letter cell not covered by a word.

- [ ] **Step 1: Write failing tests**

```js
test('deriveSlots: slots with crossings from a valid mask', function () {
  // D(RB,BR): V slot [1,3], H slot [2,3], crossing at cell 3
  var m = M(2, 2, [D('RB', 'BR'), L(), L(), L()]);
  var slots = mask.deriveSlots(m);
  assert.strictEqual(slots.length, 2);
  assert.strictEqual(slots[0].axis, 'V');
  assert.deepStrictEqual(slots[0].crossings, [{ slotIndex: 1, ownPos: 1, otherPos: 1 }]);
  assert.strictEqual(slots[0].defCell, 0);
  assert.strictEqual(slots[1].arrowIndex, 1);
});

test('deriveSlots: null on a word shorter than 2', function () {
  assert.strictEqual(mask.deriveSlots(M(2, 1, [D('R'), L()])), null);
});

test('deriveSlots: null on same-axis overlap', function () {
  var m = M(4, 2, [D('BR'), D('BR'), L(), L(), L(), L(), L(), L()]);
  assert.strictEqual(mask.deriveSlots(m), null);
});

test('deriveSlots: null when a letter cell is uncovered', function () {
  // H word [1,2] on row 0; cells 3,4,5 uncovered letters
  var m = M(3, 2, [D('R'), L(), L(), L(), L(), L()]);
  assert.strictEqual(mask.deriveSlots(m), null);
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

```js
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

  slots.forEach(function (slot) {
    var other = slot.axis === 'H' ? vOwner : hOwner;
    slot.cells.forEach(function (cellIndex, pos) {
      var hit = other.get(cellIndex);
      if (hit) slot.crossings.push({ slotIndex: hit.slotIndex, ownPos: pos, otherPos: hit.pos });
    });
  });
  return slots;
}
```

Export `deriveSlots`.

- [ ] **Step 4: `pnpm test` — all pass**
- [ ] **Step 5: Commit** — `git commit -m "feat: slot derivation with validity gate (overlap, coverage, min length)"`

---

### Task 4: mask.js — hillclimber

**Files:**
- Modify: `grid_generator/mask.js`
- Modify: `test/mask.test.js`

**Interfaces:**
- Produces: `generateMask(nbLines, nbColumns, rng, options?) -> { cells, nbLines, nbColumns, penalty }`.
  Options: `{ weights, defRatio=0.2, maxStale=5000, maxIterations=500000 }`. Deterministic for a given rng.

- [ ] **Step 1: Write failing tests**

```js
test('generateMask: deterministic for a fixed seed', function () {
  var a = mask.generateMask(9, 9, mask.mulberry32(7));
  var b = mask.generateMask(9, 9, mask.mulberry32(7));
  assert.deepStrictEqual(a, b);
});

test('generateMask: returned penalty matches a fresh full rescore', function () {
  var m = mask.generateMask(9, 9, mask.mulberry32(3));
  assert.strictEqual(m.penalty, mask.scoreMask(m));
});

test('generateMask: converged 9x9 masks are valid (deriveSlots accepts them)', function () {
  // The hillclimber must at minimum eliminate all hard-validity penalties
  // (uncovered cells at 1500, overlaps at 600, sub-2-letter words) before
  // going stale - these seeds are a regression canary, not a proof.
  [1, 2, 3].forEach(function (seed) {
    var m = mask.generateMask(9, 9, mask.mulberry32(seed));
    assert.notStrictEqual(mask.deriveSlots(m), null, 'seed ' + seed);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

```js
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
    else { cells[idx] = saved; stale++; }
  }

  mask.penalty = penalty;
  return mask;
}
```

Export `generateMask`.

- [ ] **Step 4: `pnpm test` — all pass.** If the "valid at convergence" test fails for a seed, first check whether raising `maxStale` for that test (e.g. 20000) fixes it; if hard-validity penalties persist even then, the scoring has a bug — debug scoring, do not blindly raise budgets.

- [ ] **Step 5: Benchmark (informational, not a test):**

```bash
node -e "
var mask = require('./grid_generator/mask');
var t0 = Date.now();
var m = mask.generateMask(15, 15, mask.mulberry32(42));
console.log('15x15 hillclimb:', Date.now() - t0, 'ms, penalty', m.penalty);
"
```

Record the number in the commit message. If it exceeds ~30s, open a follow-up for incremental scoring (do NOT block this plan on it).

- [ ] **Step 6: Commit** — `git commit -m "feat: hillclimber mask generation (15x15 hillclimb: <N>ms at seed 42)"`

---

### Task 5: fill.js — MRV + forward-checking solver

**Files:**
- Create: `grid_generator/fill.js`
- Create: `test/fill.test.js`

**Interfaces:**
- Consumes: slots from `mask.deriveSlots` (only `length`, `cells`, `crossings` are read), `dictionary` from `grid_generator/dictionary.js` (`candidatesFor(length, constraints, excluded)`).
- Produces: `solve(slots, dictionary, options?) -> string[] | null` (word per slot index). Options: `{ maxBacktracks=500000, timeoutMs=30000, stats }`; when `options.stats` is an object, `stats.backtracks` is set on return.

- [ ] **Step 1: Write failing tests**

```js
// test/fill.test.js
var test = require('node:test');
var assert = require('node:assert');
var dictionaryLib = require('../grid_generator/dictionary');
var fill = require('../grid_generator/fill');

function dico(words) {
  return dictionaryLib.buildDictionary(words.map(function (w) {
    return { word: w, definitions: ['def ' + w] };
  }));
}

test('solve: trivial single slot', function () {
  var slots = [{ axis: 'H', cells: [1, 2, 3, 4], length: 4, crossings: [] }];
  assert.deepStrictEqual(fill.solve(slots, dico(['ABCD'])), ['ABCD']);
});

test('solve: null when no word fits', function () {
  var slots = [{ axis: 'H', cells: [1, 2, 3], length: 3, crossings: [] }];
  assert.strictEqual(fill.solve(slots, dico(['ABCD'])), null);
});

test('solve: crossing constraint respected', function () {
  // H [0,1] crosses V [1,3] at H pos1 / V pos0
  var slots = [
    { axis: 'H', cells: [0, 1], length: 2, crossings: [{ slotIndex: 1, ownPos: 1, otherPos: 0 }] },
    { axis: 'V', cells: [1, 3], length: 2, crossings: [{ slotIndex: 0, ownPos: 0, otherPos: 1 }] }
  ];
  var result = fill.solve(slots, dico(['AB', 'BC']));
  assert.deepStrictEqual(result, ['AB', 'BC']); // B shared at cell 1
});

test('solve: a word is never used twice', function () {
  var slots = [
    { axis: 'H', cells: [0, 1], length: 2, crossings: [] },
    { axis: 'H', cells: [3, 4], length: 2, crossings: [] }
  ];
  assert.strictEqual(fill.solve(slots, dico(['AB'])), null);
  var result = fill.solve(slots, dico(['AB', 'CD']));
  assert.deepStrictEqual(result.slice().sort(), ['AB', 'CD']);
});

test('solve: forward checking prunes dead branches without backtracking', function () {
  // H [0,1] crossed at both cells by V slots. Candidates for H: AB then AY.
  // Placing AB kills V2 (needs a word starting B, only BZ exists but B?
  // -> give V2 only 'YZ' so 'AB' fails FC immediately, 'AY' succeeds).
  var slots = [
    { axis: 'H', cells: [0, 1], length: 2,
      crossings: [{ slotIndex: 1, ownPos: 0, otherPos: 0 }, { slotIndex: 2, ownPos: 1, otherPos: 0 }] },
    { axis: 'V', cells: [0, 2], length: 2, crossings: [{ slotIndex: 0, ownPos: 0, otherPos: 0 }] },
    { axis: 'V', cells: [1, 3], length: 2, crossings: [{ slotIndex: 0, ownPos: 0, otherPos: 1 }] }
  ];
  var stats = {};
  var result = fill.solve(slots, dico(['AB', 'AY', 'AQ', 'YZ']), { stats: stats });
  assert.notStrictEqual(result, null);
  assert.strictEqual(result[0], 'AY');   // 'AB' rejected by FC ('B?' has no candidate)
  assert.strictEqual(result[2], 'YZ');
  assert.ok(stats.backtracks <= 2, 'FC should cut early, got ' + stats.backtracks + ' backtracks');
});

test('solve: respects maxBacktracks budget', function () {
  var slots = [
    { axis: 'H', cells: [0, 1], length: 2, crossings: [{ slotIndex: 1, ownPos: 0, otherPos: 0 }] },
    { axis: 'V', cells: [0, 2], length: 2, crossings: [{ slotIndex: 0, ownPos: 0, otherPos: 0 }] }
  ];
  // no consistent pair exists -> must terminate quickly and return null
  assert.strictEqual(fill.solve(slots, dico(['AB', 'CD']), { maxBacktracks: 5 }), null);
});
```

Note for the executor on the FC test: verify the scenario by hand before running — H candidates of length 2 from this dico in pool order; `AB` placed ⇒ V slot 2 has constraint `{pos:0, letter:'B'}` ⇒ no length-2 word starts with B ⇒ FC fails ⇒ `AB` undone (this increments `backtracks` once); `AY` placed ⇒ V1 needs `A?` (`AB`? used-check: `AY` used, `AB` free ⇒ ok) and V2 needs `Y?` (`YZ` ✓) ⇒ solution. If the assertion on `result[1]` is wanted, it is `AB` or `AQ` (whichever MRV+order picks) — assert only `result[0]` and `result[2]` as written.

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

```js
// grid_generator/fill.js
function solve(slots, dictionary, options) {
  options = options || {};
  var maxBacktracks = options.maxBacktracks !== undefined ? options.maxBacktracks : 500000;
  var timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : 30000;
  var deadline = Date.now() + timeoutMs;

  var assignment = new Array(slots.length).fill(null);
  var letters = new Map(); // cellIndex -> letter placed by some assigned slot
  var used = new Set();
  var backtracks = 0;

  function constraintsFor(slot) {
    var constraints = [];
    for (var p = 0; p < slot.cells.length; p++) {
      var letter = letters.get(slot.cells[p]);
      if (letter !== undefined) constraints.push({ pos: p, letter: letter });
    }
    return constraints;
  }

  function search(remaining) {
    if (remaining === 0) return true;
    if (backtracks > maxBacktracks || Date.now() > deadline) return false;

    // MRV: expand the unassigned slot with the fewest candidates
    var best = -1, bestCandidates = null;
    for (var s = 0; s < slots.length; s++) {
      if (assignment[s] !== null) continue;
      var candidates = dictionary.candidatesFor(slots[s].length, constraintsFor(slots[s]), used);
      if (bestCandidates === null || candidates.length < bestCandidates.length) {
        best = s;
        bestCandidates = candidates;
        if (candidates.length === 0) break;
      }
    }
    if (bestCandidates.length === 0) return false;

    var slot = slots[best];
    for (var i = 0; i < bestCandidates.length; i++) {
      var word = bestCandidates[i];
      var placed = [];
      for (var p = 0; p < slot.cells.length; p++) {
        if (!letters.has(slot.cells[p])) { letters.set(slot.cells[p], word[p]); placed.push(slot.cells[p]); }
      }
      assignment[best] = word;
      used.add(word);

      // forward checking: every unassigned crossing slot must keep >= 1 candidate
      var ok = true;
      for (var c = 0; c < slot.crossings.length; c++) {
        var crossIdx = slot.crossings[c].slotIndex;
        if (assignment[crossIdx] !== null) continue;
        if (dictionary.candidatesFor(slots[crossIdx].length, constraintsFor(slots[crossIdx]), used).length === 0) {
          ok = false;
          break;
        }
      }

      if (ok && search(remaining - 1)) return true;

      placed.forEach(function (cell) { letters.delete(cell); });
      assignment[best] = null;
      used.delete(word);
      backtracks++;
      if (backtracks > maxBacktracks || Date.now() > deadline) return false;
    }
    return false;
  }

  var found = search(slots.length);
  if (options.stats) options.stats.backtracks = backtracks;
  return found ? assignment : null;
}

module.exports = { solve: solve };
```

- [ ] **Step 4: `pnpm test` — all pass**
- [ ] **Step 5: Commit** — `git commit -m "feat: MRV + forward-checking fill solver"`

---

### Task 6: export.js

**Files:**
- Create: `grid_generator/export.js`
- Create: `test/export.test.js`

**Interfaces:**
- Consumes: mask, slots (from `mask.deriveSlots` — uses `defCell`, `arrowIndex`, `cells`), assignment (from `fill.solve`), dictionary (`definitionsByWord`).
- Produces: `exportGrid(mask, slots, assignment, dictionary) -> { nbLines, nbColumns, nbWords, cases }` using `game_files/case.js` classes; `ARROW_CODES = { R: 0, RB: 1, B: 2, BR: 3 }`.

- [ ] **Step 1: Write failing tests**

```js
// test/export.test.js
var test = require('node:test');
var assert = require('node:assert');
var maskLib = require('../grid_generator/mask');
var dictionaryLib = require('../grid_generator/dictionary');
var exportLib = require('../grid_generator/export');
var enums = require('../game_files/enums');

function L() { return { kind: 'L' }; }
function D() { return { kind: 'D', arrows: Array.prototype.slice.call(arguments) }; }

test('exportGrid: letters, arrow codes and shortest definitions', function () {
  // 2x2, D(RB,BR) at 0: V slot [1,3] and H slot [2,3]
  var m = { cells: [D('RB', 'BR'), L(), L(), L()], nbLines: 2, nbColumns: 2 };
  var slots = maskLib.deriveSlots(m);
  var dico = dictionaryLib.buildDictionary([
    { word: 'AB', definitions: ['une definition assez longue', 'courte'] },
    { word: 'CB', definitions: ['def cb'] }
  ]);
  // V slot gets AB (cells 1,3), H slot gets CB (cells 2,3) - shared B at cell 3
  var grid = exportLib.exportGrid(m, slots, ['AB', 'CB'], dico);

  assert.strictEqual(grid.nbLines, 2);
  assert.strictEqual(grid.nbWords, 2);
  assert.strictEqual(grid.cases[0].type, enums.CaseType.Description);
  assert.strictEqual(grid.cases[0].nbDesc, 2);
  assert.deepStrictEqual(grid.cases[0].arrow, [1, 3]); // RB=1, BR=3
  assert.deepStrictEqual(grid.cases[0].desc, ['courte', 'def cb']); // shortest picked
  assert.strictEqual(grid.cases[1].value, 'A');
  assert.strictEqual(grid.cases[2].value, 'C');
  assert.strictEqual(grid.cases[3].value, 'B');
  assert.strictEqual(grid.cases[1].type, enums.CaseType.Letter);
});

test('exportGrid: straight arrows use codes 0 and 2', function () {
  var m = { cells: [D('R', 'B'), L(), L(), L(), L(), L(), L(), L(), L()], nbLines: 3, nbColumns: 3 };
  // R word [1,2], B word [3,6]; remaining letters must be covered for deriveSlots:
  // add defs - simpler: build slots by hand for this test
  var slots = [
    { axis: 'H', cells: [1, 2], length: 2, crossings: [], defCell: 0, arrowIndex: 0 },
    { axis: 'V', cells: [3, 6], length: 2, crossings: [], defCell: 0, arrowIndex: 1 }
  ];
  var dico = dictionaryLib.buildDictionary([
    { word: 'AB', definitions: ['x'] }, { word: 'CD', definitions: ['y'] }
  ]);
  var grid = exportLib.exportGrid(m, slots, ['AB', 'CD'], dico);
  assert.deepStrictEqual(grid.cases[0].arrow, [0, 2]);
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

```js
// grid_generator/export.js
var Case = require('../game_files/case');

// Client contract (public/javascripts/game/grid.js createDescriptionArrows):
// 0=Right, 1=RightBottom (bent), 2=Bottom, 3=BottomRight (bent).
// This is gridManager.js's local enumArrow, NOT enums.ArrowDirections.
var ARROW_CODES = { R: 0, RB: 1, B: 2, BR: 3 };

function shortestDefinition(defs) {
  return defs.reduce(function (shortest, d) { return d.length < shortest.length ? d : shortest; });
}

function exportGrid(mask, slots, assignment, dictionary) {
  var cases = mask.cells.map(function (cell, idx) {
    if (cell.kind === 'L') return new Case.LetterCase(idx, null);
    return new Case.DescriptionCase(idx, 'a');
  });

  var slotByArrow = new Map(); // defCell * 2 + arrowIndex -> slot index
  slots.forEach(function (slot, slotIdx) {
    slotByArrow.set(slot.defCell * 2 + slot.arrowIndex, slotIdx);
    slot.cells.forEach(function (cellIndex, pos) {
      cases[cellIndex].value = assignment[slotIdx][pos];
    });
  });

  mask.cells.forEach(function (cell, idx) {
    if (cell.kind !== 'D') return;
    var target = cases[idx];
    target.nbDesc = cell.arrows.length;
    target.nbLines = cell.arrows.length;
    target.desc = [];
    target.arrow = [];
    cell.arrows.forEach(function (arrow, arrowIndex) {
      var slotIdx = slotByArrow.get(idx * 2 + arrowIndex);
      var defs = dictionary.definitionsByWord.get(assignment[slotIdx]) || [];
      target.desc.push(defs.length > 0 ? shortestDefinition(defs) : '');
      target.arrow.push(ARROW_CODES[arrow]);
    });
  });

  return { nbLines: mask.nbLines, nbColumns: mask.nbColumns, nbWords: slots.length, cases: cases };
}

module.exports = { exportGrid: exportGrid, ARROW_CODES: ARROW_CODES };
```

- [ ] **Step 4: `pnpm test` — all pass**
- [ ] **Step 5: Commit** — `git commit -m "feat: grid export with bent-arrow codes"`

---

### Task 7: The swap — new validate.js, new generate-grid.js, delete the old pipeline

This task rewrites two files in place and deletes the old modules, atomically: at the end of the task `pnpm test` is fully green with only the new pipeline present.

**Files:**
- Rewrite: `grid_generator/validate.js` + `test/validate.test.js`
- Rewrite: `scripts/generate-grid.js` + `test/generate.test.js`
- Delete: `grid_generator/skeleton.js`, `grid_generator/backtracking.js`, `grid_generator/exporter.js`, `grid_generator/slots.js`, `grid_generator/minConflicts.js`, `grid_generator/constraintPropagation.js`, `scripts/benchmark-fill.js`
- Delete: `test/skeleton.test.js`, `test/backtracking.test.js`, `test/exporter.test.js`, `test/slots.test.js`, `test/minConflicts.test.js`, `test/constraintPropagation.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces:
  - `validateGrid(grid, dictionary?) -> { valid, errors: string[] }` — dictionary optional; when present, word membership is checked.
  - `generate(nbLines, nbColumns, dictionary, options?) -> grid | null` and re-exported `mulberry32` (kept for any external caller; it now delegates to `mask.mulberry32`).

- [ ] **Step 1: Check for stray users of the deleted modules and of `stats.js`**

Run: `grep -rn "skeleton\|backtracking\|exporter\|require.*slots\|minConflicts\|constraintPropagation\|stats" --include="*.js" scripts/ grid_generator/ game_files/ | grep -v node_modules`
Expected: hits only in files this task rewrites/deletes. `grid_generator/stats.js` stays ONLY if a scrape script requires it (it computes `gso-stats.json`, which the new generator no longer reads); if nothing outside its own test requires it, delete `grid_generator/stats.js` + `test/stats.test.js` too.

- [ ] **Step 2: Write the new `test/validate.test.js` (replaces the old file entirely)**

```js
var test = require('node:test');
var assert = require('node:assert');
var enums = require('../game_files/enums');
var validate = require('../grid_generator/validate');

// grid builder: 2x2 valid reference grid
// D(RB=1, BR=3) at 0 -> V word cells [1,3] = "AB", H word cells [2,3] = "CB"
function validGrid() {
  return {
    nbLines: 2, nbColumns: 2,
    cases: [
      { type: enums.CaseType.Description, nbDesc: 2, desc: ['d1', 'd2'], arrow: [1, 3] },
      { type: enums.CaseType.Letter, value: 'A' },
      { type: enums.CaseType.Letter, value: 'C' },
      { type: enums.CaseType.Letter, value: 'B' }
    ]
  };
}

test('accepts a valid bent-arrow grid', function () {
  assert.deepStrictEqual(validate.validateGrid(validGrid()), { valid: true, errors: [] });
});

test('flags a letter cell without a value', function () {
  var g = validGrid();
  g.cases[1].value = null;
  assert.strictEqual(validate.validateGrid(g).valid, false);
});

test('flags a missing definition', function () {
  var g = validGrid();
  g.cases[0].desc[1] = '';
  var r = validate.validateGrid(g);
  assert.ok(r.errors.some(function (e) { return e.indexOf('efinition') !== -1; }));
});

test('flags an unclued letter run (no arrow points at it)', function () {
  // 3x1: all letters, no description at all
  var g = { nbLines: 3, nbColumns: 1, cases: [
    { type: enums.CaseType.Letter, value: 'A' },
    { type: enums.CaseType.Letter, value: 'B' },
    { type: enums.CaseType.Letter, value: 'C' }
  ] };
  var r = validate.validateGrid(g);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(function (e) { return e.indexOf('clue') !== -1 || e.indexOf('couvert') !== -1; }));
});

test('flags a word that is not a maximal run (merged run)', function () {
  // 3x1: D(R) A B but a third letter C follows the word... impossible in 3x1;
  // use 4x1: D(R)->word [1,2,3]="ABC" is fine; instead craft a bent word starting mid-run:
  // 2x3 (nbLines=2, nbColumns=3): col 0 letters rows 0-2 = A,B,C; D at (0,1) with RB?
  // Simplest merged case: arrow B at (0,1) -> V word [3? ] ... build explicitly:
  // nbLines=2: idx (r,c) = r*2+c. Letters at (0,0),(1,0),(2,0); D at (0,1) arrow code 1 (RB)
  // -> RB from (0,1): start (0,2) off-grid -> length 0 error AND run [0,2,4] unclued.
  var g = { nbLines: 2, nbColumns: 3, cases: [
    { type: enums.CaseType.Letter, value: 'A' },
    { type: enums.CaseType.Description, nbDesc: 1, desc: ['d'], arrow: [1] },
    { type: enums.CaseType.Letter, value: 'B' },
    { type: enums.CaseType.Description, nbDesc: 1, desc: ['d'], arrow: [2] },
    { type: enums.CaseType.Letter, value: 'C' },
    { type: enums.CaseType.Letter, value: 'D' }
  ] };
  // arrow at idx1 (RB) walks V from (0,2)? -> col 2 doesn't exist (nbLines=2) -> len 0
  // arrow at idx3 (B) walks V from (2,1): cell 5 = 'D', word [5] len 1
  // vertical run col0 [0,2,4] has no arrow -> unclued
  var r = validate.validateGrid(g);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.length >= 2);
});

test('flags duplicate words', function () {
  // two H words with the same letters: 3x2, D(R) on each row, words "AB" twice
  var g = { nbLines: 3, nbColumns: 2, cases: [
    { type: enums.CaseType.Description, nbDesc: 1, desc: ['d'], arrow: [0] },
    { type: enums.CaseType.Letter, value: 'A' },
    { type: enums.CaseType.Letter, value: 'B' },
    { type: enums.CaseType.Description, nbDesc: 1, desc: ['d'], arrow: [0] },
    { type: enums.CaseType.Letter, value: 'A' },
    { type: enums.CaseType.Letter, value: 'B' }
  ] };
  // NOTE: single-covered letters are fine for validate (quality, not validity)
  var r = validate.validateGrid(g);
  assert.ok(r.errors.some(function (e) { return e.indexOf('double') !== -1; }));
});

test('checks dictionary membership when a dictionary is provided', function () {
  var dictionaryLib = require('../grid_generator/dictionary');
  var dico = dictionaryLib.buildDictionary([{ word: 'XX', definitions: ['x'] }]);
  var r = validate.validateGrid(validGrid(), dico); // AB, CB not in dico
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(function (e) { return e.indexOf('dico') !== -1; }));
});
```

- [ ] **Step 3: Write the new `grid_generator/validate.js`**

```js
// grid_generator/validate.js
var enums = require('../game_files/enums');

// arrow codes as exported by export.js (client contract):
// 0=R (start right, run H) 1=RB (start right, run V) 2=B (start below, run V) 3=BR (start below, run H)
function arrowGeometry(grid, idx, code) {
  var col = idx % grid.nbLines;
  var row = (idx - col) / grid.nbLines;
  var startsRight = code === 0 || code === 1;
  var axis = (code === 0 || code === 3) ? 'H' : 'V';
  var start;
  if (startsRight) start = col + 1 < grid.nbLines ? idx + 1 : -1;
  else start = row + 1 < grid.nbColumns ? idx + grid.nbLines : -1;
  return { start: start, axis: axis };
}

function walk(grid, start, axis) {
  var cells = [];
  if (start === -1) return cells;
  var col = start % grid.nbLines;
  var row = (start - col) / grid.nbLines;
  while (row < grid.nbColumns && col < grid.nbLines &&
         grid.cases[row * grid.nbLines + col].type === enums.CaseType.Letter) {
    cells.push(row * grid.nbLines + col);
    if (axis === 'H') col++; else row++;
  }
  return cells;
}

// all maximal Letter runs (any length >= 1) along one axis
function scanRuns(grid, axis) {
  var runs = [];
  var outerCount = axis === 'H' ? grid.nbColumns : grid.nbLines;
  var innerCount = axis === 'H' ? grid.nbLines : grid.nbColumns;
  for (var outer = 0; outer < outerCount; outer++) {
    var run = [];
    for (var inner = 0; inner < innerCount; inner++) {
      var idx = axis === 'H' ? outer * grid.nbLines + inner : inner * grid.nbLines + outer;
      if (grid.cases[idx].type === enums.CaseType.Letter) run.push(idx);
      else if (run.length) { runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);
  }
  return runs;
}

function validateGrid(grid, dictionary) {
  var errors = [];
  var words = [];

  if (grid.cases.length !== grid.nbLines * grid.nbColumns) {
    errors.push('Dimensions incoherentes: ' + grid.cases.length + ' cases pour ' + grid.nbLines + 'x' + grid.nbColumns);
    return { valid: false, errors: errors };
  }

  grid.cases.forEach(function (cell, idx) {
    if (cell.type === enums.CaseType.Letter) {
      if (!cell.value || !/^[A-Z]$/.test(cell.value)) errors.push('Case lettre sans valeur valide a index ' + idx);
      return;
    }
    if (cell.type !== enums.CaseType.Description) {
      errors.push('Type de case inconnu a index ' + idx);
      return;
    }
    if (!cell.arrow || !cell.desc || cell.arrow.length !== cell.nbDesc) {
      errors.push('Case description incoherente a index ' + idx);
      return;
    }
    cell.arrow.forEach(function (code, i) {
      var geo = arrowGeometry(grid, idx, code);
      var cells = walk(grid, geo.start, geo.axis);
      if (cells.length < 2) errors.push('Mot de longueur ' + cells.length + ' (fleche ' + i + ', case ' + idx + ')');
      if (!cell.desc[i]) errors.push('Definition manquante (fleche ' + i + ', case ' + idx + ')');
      words.push({
        axis: geo.axis,
        cells: cells,
        key: geo.axis + ':' + cells.join(','),
        value: cells.map(function (c) { return grid.cases[c].value; }).join('')
      });
    });
  });

  // duplicates + dictionary membership
  var seen = new Set();
  words.forEach(function (w) {
    if (w.cells.length < 2) return;
    if (seen.has(w.value)) errors.push('Mot en double: ' + w.value);
    seen.add(w.value);
    if (dictionary && !dictionary.definitionsByWord.has(w.value)) errors.push('Mot hors dico: ' + w.value);
  });

  // run/word equivalence: every arrow word is a maximal run, every run >= 2 is
  // clued exactly once, every 1-cell run is covered by the perpendicular axis
  ['H', 'V'].forEach(function (axis) {
    var axisWords = words.filter(function (w) { return w.axis === axis; });
    var wordKeys = new Map();
    axisWords.forEach(function (w) {
      if (wordKeys.has(w.key)) errors.push('Mot clue deux fois (' + w.key + ')');
      wordKeys.set(w.key, w);
    });
    var runKeys = new Set();
    scanRuns(grid, axis).forEach(function (run) {
      var key = axis + ':' + run.join(',');
      runKeys.add(key);
      if (run.length >= 2 && !wordKeys.has(key)) {
        errors.push('Run ' + axis + ' non clue ou fusionne a partir de la case ' + run[0]);
      }
    });
    wordKeys.forEach(function (w, key) {
      if (w.cells.length >= 2 && !runKeys.has(key)) {
        errors.push('Mot non maximal (demarre ou finit en plein run): ' + key);
      }
    });
  });

  // 1-cell runs must be crossed by the other axis
  var coveredByWord = new Set();
  words.forEach(function (w) { w.cells.forEach(function (c) { coveredByWord.add(w.axis + c); }); });
  ['H', 'V'].forEach(function (axis) {
    var other = axis === 'H' ? 'V' : 'H';
    scanRuns(grid, axis).forEach(function (run) {
      if (run.length === 1 && !coveredByWord.has(other + run[0])) {
        errors.push('Case lettre orpheline (non couverte) a index ' + run[0]);
      }
    });
  });

  return { valid: errors.length === 0, errors: errors };
}

module.exports = { validateGrid: validateGrid };
```

- [ ] **Step 4: Run `node --test test/validate.test.js` — new validate tests pass.** Hand-verify each fixture in the tests against the rules before adjusting any expectation.

- [ ] **Step 5: Write the new `scripts/generate-grid.js`**

```js
// scripts/generate-grid.js
var fs = require('fs');
var path = require('path');
var dictionaryLib = require('../grid_generator/dictionary');
var maskLib = require('../grid_generator/mask');
var fillLib = require('../grid_generator/fill');
var exportLib = require('../grid_generator/export');
var validateLib = require('../grid_generator/validate');
var lexiqueFrequencyLib = require('../grid_generator/lexiqueFrequency');

function generate(nbLines, nbColumns, dictionary, options) {
  options = options || {};
  var maxMaskAttempts = options.maxMaskAttempts !== undefined ? options.maxMaskAttempts : 30;
  var rng = options.rng || maskLib.mulberry32(options.seed !== undefined ? options.seed : Date.now());

  for (var attempt = 0; attempt < maxMaskAttempts; attempt++) {
    var mask = maskLib.generateMask(nbLines, nbColumns, rng, {
      weights: options.weights,
      maxStale: options.maxStale
    });
    var slots = maskLib.deriveSlots(mask);
    if (!slots) continue; // hillclimber went stale on an invalid mask - next seed
    if (options.onAttempt) options.onAttempt(attempt + 1, maxMaskAttempts, slots.length, mask.penalty);

    var assignment = fillLib.solve(slots, dictionary, {
      maxBacktracks: options.maxBacktracks,
      timeoutMs: options.timeoutMs
    });
    if (!assignment) continue;

    var grid = exportLib.exportGrid(mask, slots, assignment, dictionary);
    if (validateLib.validateGrid(grid, dictionary).valid) return grid;
  }
  return null;
}

if (require.main === module) {
  // node scripts/generate-grid.js 15       -> 15x15
  // node scripts/generate-grid.js 13 15    -> 13 wide x 15 tall
  var nbLines = parseInt(process.argv[2], 10) || 15;
  var nbColumns = parseInt(process.argv[3], 10) || nbLines;
  var dico = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dico.json'), 'utf8'));
  var lexiqueRaw = fs.readFileSync(path.join(__dirname, '..', 'data', 'Lexique4.tsv'), 'utf8');
  var dictionary = dictionaryLib.buildDictionary(dico, lexiqueFrequencyLib.buildFrequencyMap(lexiqueRaw));

  var grid = generate(nbLines, nbColumns, dictionary, {
    onAttempt: function (n, total, nbSlots, penalty) {
      console.log('Tentative ' + n + '/' + total + ' (' + nbSlots + ' slots, penalite masque ' + penalty + ')...');
    }
  });
  if (!grid) {
    console.error('Echec de generation apres plusieurs tentatives.');
    process.exit(1);
  }

  fs.writeFileSync(path.join(__dirname, '..', 'data', 'generated-grid.json'), JSON.stringify(grid, null, 2));
  console.log('Grille generee: data/generated-grid.json');
}

module.exports = { generate: generate, mulberry32: maskLib.mulberry32 };
```

- [ ] **Step 6: Write the new `test/generate.test.js`**

```js
// test/generate.test.js
var test = require('node:test');
var assert = require('node:assert');
var dictionary = require('../grid_generator/dictionary');
var generateGrid = require('../scripts/generate-grid');

test('generate returns null quickly when the dictionary cannot fill anything', function () {
  var dico = dictionary.buildDictionary([{ word: 'ABC', definitions: ['x'] }]);
  var grid = generateGrid.generate(9, 9, dico, {
    seed: 1, maxMaskAttempts: 2, maxStale: 500, maxBacktracks: 100, timeoutMs: 2000
  });
  assert.strictEqual(grid, null);
});

test('generate reports attempts via onAttempt', function () {
  var calls = 0;
  var dico = dictionary.buildDictionary([{ word: 'ABC', definitions: ['x'] }]);
  generateGrid.generate(9, 9, dico, {
    seed: 1, maxMaskAttempts: 2, maxStale: 500, maxBacktracks: 100, timeoutMs: 2000,
    onAttempt: function () { calls++; }
  });
  assert.ok(calls >= 1);
});
```

(The real end-to-end success case lives in Task 8 with the real dictionary — a synthetic dico can't fill an organic 9×9.)

- [ ] **Step 7: Delete the old pipeline**

```bash
git rm grid_generator/skeleton.js grid_generator/backtracking.js grid_generator/exporter.js grid_generator/slots.js grid_generator/minConflicts.js grid_generator/constraintPropagation.js scripts/benchmark-fill.js
git rm test/skeleton.test.js test/backtracking.test.js test/exporter.test.js test/slots.test.js test/minConflicts.test.js test/constraintPropagation.test.js
# plus stats.js + test/stats.test.js if Step 1 found no other user
```

- [ ] **Step 8: `pnpm test` — full suite green.** Remaining suites: mask, fill, export, validate, generate, dictionary, lexiqueFrequency, extractWords, extractFsolverDefinitions, scrape-fsolver, gridManager.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat!: replace grid generator with mask-hillclimber pipeline

Old random-sweep skeleton + plain backtracking (and the abandoned
minConflicts / constraintPropagation experiments) removed. The new
pipeline is mask.js (penalty-driven hillclimber, arrow-defined words,
GSO bent arrows) -> fill.js (MRV + forward checking) -> export.js ->
validate.js (run/word equivalence safety net)."
```

---

### Task 8: Integration with the real dictionary + real 15×15 run

**Files:**
- Create: `test/generate.integration.test.js`

**Interfaces:**
- Consumes: `generate` from Task 7, real `data/dico.json` + `data/Lexique4.tsv`.

- [ ] **Step 1: Find a working seed empirically**

```bash
node -e "
var fs = require('fs'), path = require('path');
var dictionaryLib = require('./grid_generator/dictionary');
var lexiqueFrequencyLib = require('./grid_generator/lexiqueFrequency');
var generateGrid = require('./scripts/generate-grid');
var dico = JSON.parse(fs.readFileSync('data/dico.json', 'utf8'));
var lexique = fs.readFileSync('data/Lexique4.tsv', 'utf8');
var dictionary = dictionaryLib.buildDictionary(dico, lexiqueFrequencyLib.buildFrequencyMap(lexique));
for (var seed = 1; seed <= 10; seed++) {
  var t0 = Date.now();
  var grid = generateGrid.generate(9, 9, dictionary, { seed: seed, maxMaskAttempts: 5 });
  console.log('seed', seed, grid ? 'OK' : 'null', Date.now() - t0, 'ms');
  if (grid) break;
}
"
```

Pick the first seed that succeeds in a few seconds. If NO seed works, stop and debug (mask quality vs fill budget) before writing the test — this is the moment the whole design proves itself.

- [ ] **Step 2: Write the integration test with the found seed**

```js
// test/generate.integration.test.js
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var dictionaryLib = require('../grid_generator/dictionary');
var lexiqueFrequencyLib = require('../grid_generator/lexiqueFrequency');
var validateLib = require('../grid_generator/validate');
var generateGrid = require('../scripts/generate-grid');

test('generate produces a valid 9x9 grid from the real dictionary', function () {
  var dico = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dico.json'), 'utf8'));
  var lexique = fs.readFileSync(path.join(__dirname, '..', 'data', 'Lexique4.tsv'), 'utf8');
  var dictionary = dictionaryLib.buildDictionary(dico, lexiqueFrequencyLib.buildFrequencyMap(lexique));

  var grid = generateGrid.generate(9, 9, dictionary, { seed: SEED_FROM_STEP_1, maxMaskAttempts: 5 });
  assert.notStrictEqual(grid, null);
  var result = validateLib.validateGrid(grid, dictionary);
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(grid.nbLines, 9);
});
```

Replace `SEED_FROM_STEP_1` with the actual number.

- [ ] **Step 3: `pnpm test` — green, note the integration test duration** (acceptable up to ~30s; if slower, reduce budgets in the test options, not in the defaults).

- [ ] **Step 4: Generate a real 15×15**

Run: `node scripts/generate-grid.js 15 15`
Expected: `Grille generee: data/generated-grid.json` within a few minutes at most. Report timing and mask penalty in the final summary.

- [ ] **Step 5: Commit + push**

```bash
git add test/generate.integration.test.js data/generated-grid.json
git commit -m "test: real-dictionary integration test; first hillclimber-generated 15x15"
git push origin feature/grid-generator
```

- [ ] **Step 6: Hand off to the user for in-game verification**

Ask the user to run `pnpm start`, then `!grid local` + `!start` in the chat, and visually confirm: filled top/left edges, bent arrows rendered on border description cells, no long chains of description cells, organic word mix. Weight tuning (defRatio, cluster/length tables) happens after this feedback — via the `weights` option, without code changes.

---

### Task 9: Fix the mask objective — unclued runs are a validity violation

**Why this task exists:** Task 8 found that `generate()` cannot produce a valid 15×15, and root-caused it: `scoreMask` and `deriveSlots` treat a Letter cell as "covered" when any perpendicular word owns it, but `validateGrid` (correctly) demands that **every maximal run of ≥2 cells be exactly one clued word**. So the hillclimber optimizes toward something that is not validity: ~98% of masks that pass `deriveSlots` still fail `validateGrid` with "Run H/V non clue".

Spec §3 already states the correct rule — *"un run de lettres sans flèche qui le pointe = lettres non couvertes = pénalité"* — Task 2's per-cell `hCov`/`vCov` implementation simply did not encode it. The spec stands; the implementation is wrong.

This was verified against reality, not assumed: real GSO grid 2118 has **zero** genuinely unclued runs (the one apparent exception traces to a pre-existing `gridManager.js` bug mapping the char `'t'` to `Bottom` instead of `RightBottom`).

**Files:**
- Modify: `grid_generator/mask.js`
- Modify: `test/mask.test.js`
- Modify: `test/generate.integration.test.js` (seed may change)

**Interfaces:**
- Consumes: everything already in `mask.js`.
- Produces: `DEFAULT_WEIGHTS.uncluedRun` (new weight); `scanRuns(mask, axis)` internal helper; `deriveSlots` gains a run-equivalence gate; `generateMask` accepts equal-penalty (plateau) moves.

- [ ] **Step 1: Write the failing tests**

```js
// append to test/mask.test.js

test('scoreMask: a maximal run of 2+ with no arrow pointing at it is penalized', function () {
  var w = zeroWeights(); w.uncluedRun = 1500;
  // 3 wide, 1 tall, all letters, no description at all -> one unclued H run [0,1,2].
  // Each column is a 1-cell V run, which is never an unclued-run violation.
  assert.strictEqual(mask.scoreMask(M(3, 1, [L(), L(), L()]), w), 1500);
});

test('scoreMask: a properly clued maximal run costs nothing', function () {
  var w = zeroWeights(); w.uncluedRun = 1500;
  assert.strictEqual(mask.scoreMask(M(3, 1, [D('R'), L(), L()]), w), 0);
});

test('scoreMask: cells fully covered on the other axis still owe for their unclued runs', function () {
  var w = zeroWeights(); w.uncluedRun = 1500;
  // 2 wide, 3 tall. Two B arrows clue both columns fully, so every letter cell
  // IS owned by a vertical word - but rows 1 and 2 are each an unclued H run of 2.
  var m = M(2, 3, [D('B'), D('B'), L(), L(), L(), L()]);
  assert.strictEqual(mask.scoreMask(m, w), 3000);
});

test('deriveSlots: null when a maximal run is not clued, even if every cell is covered', function () {
  // same mask as above: vertical coverage is complete, horizontal runs are unclued
  var m = M(2, 3, [D('B'), D('B'), L(), L(), L(), L()]);
  assert.strictEqual(mask.deriveSlots(m), null);
});

test('deriveSlots: still accepts a mask whose every run is clued', function () {
  var m = M(2, 2, [D('RB', 'BR'), L(), L(), L()]);
  assert.notStrictEqual(mask.deriveSlots(m), null);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test test/mask.test.js`
Expected: the four new penalty/gate tests FAIL (`uncluedRun` unknown → 0 penalty; `deriveSlots` returns slots instead of null).

- [ ] **Step 3: Implement**

Add the run scanner near `deriveWords` in `grid_generator/mask.js`:

```js
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
```

Add `uncluedRun: 1500` to `DEFAULT_WEIGHTS` (same tier as `uncovered` — both are hard validity violations, not quality nudges).

In `scoreMask`, add the term to the returned total. The existing return is
`return total + clusterPenalty(mask, w);` — make it:

```js
  return total + clusterPenalty(mask, w) + uncluedRunPenalty(mask, words, w);
```

In `deriveSlots`, after the existing uncovered-cell loop and before the crossings pass, add the matching gate:

```js
  var clued = { H: new Set(), V: new Set() };
  slots.forEach(function (slot) { clued[slot.axis].add(slot.cells.join(',')); });
  var axes = ['H', 'V'];
  for (var a = 0; a < axes.length; a++) {
    var runs = scanRuns(mask, axes[a]);
    for (var r = 0; r < runs.length; r++) {
      if (runs[r].length >= 2 && !clued[axes[a]].has(runs[r].join(','))) return null;
    }
  }
```

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test test/mask.test.js`
Expected: PASS. The Task 4 canary test (`generateMask` converges on seeds 6/12/25) may now fail — that is expected, the objective changed. Do not delete it; Step 6 re-derives its seeds.

- [ ] **Step 5: Let the hillclimber escape plateaus**

The Task 4 investigation established that strict-improvement single-cell hillclimbing gets stuck: escaping a local optimum needs a temporarily-equal-or-worse move. Accepting *equal*-penalty moves costs nothing in solution quality and lets the search drift along plateaus. Keep counting them as stale so the break condition still terminates.

In `generateMask`, replace the accept/revert branch:

```js
    var next = scoreMask(mask, w);
    if (next < penalty) { penalty = next; stale = 0; }
    else if (next === penalty) { stale++; }  // plateau move: keep it, still count toward the break
    else { cells[idx] = saved; stale++; }
```

- [ ] **Step 6: Re-derive the convergence canary**

Measure how many seeds now converge to a `deriveSlots`-valid 9×9 mask:

```bash
node -e "
var mask = require('./grid_generator/mask');
var ok = [];
for (var s = 1; s <= 40; s++) {
  var m = mask.generateMask(9, 9, mask.mulberry32(s));
  if (mask.deriveSlots(m)) ok.push(s);
}
console.log('valid seeds', ok.length + '/40:', ok.join(','));
"
```

Update the Task 4 canary test to three seeds from that list, and update its explanatory comment with the new measured rate. Report the before (3/30) and after numbers.

- [ ] **Step 7: Full suite**

Run: `pnpm test`
Expected: green. The integration test may fail if its seed no longer produces a valid grid — if so, re-run the Task 8 seed search (`generate(9, 9, dictionary, {seed: s, maxMaskAttempts: 5})` over seeds 1..40, real dictionary) and update the seed in `test/generate.integration.test.js`.

- [ ] **Step 8: Real 15×15**

Run: `node scripts/generate-grid.js 15 15` (foreground, allow up to 10 minutes).
Record: wall time, how many attempts passed `deriveSlots`, the winning mask penalty, and the word count.

If it still fails, do NOT weaken `validate.js` or inflate budgets. Report DONE_WITH_CONCERNS with the diagnosis: how many of the 30 masks passed `deriveSlots`, and for those that did, whether `fill.solve` timed out or exhausted its candidates.

- [ ] **Step 9: Commit**

```bash
git add grid_generator/mask.js test/mask.test.js test/generate.integration.test.js
git commit -m "fix: unclued runs are a validity violation, not a coverage nudge"
```

Use this full commit body:

```
fix: unclued runs are a validity violation, not a coverage nudge

scoreMask and deriveSlots counted a letter cell as covered whenever any
perpendicular word owned it, so the hillclimber happily converged on
masks where a whole horizontal run had no arrow pointing at it -
validateGrid rejects those, which is why ~98% of deriveSlots-valid masks
failed to export. Spec section 3 already called an unpointed run a
penalty; this encodes it. The hillclimber also now accepts equal-penalty
moves so it can drift along plateaus instead of stalling in the local
optima Task 4 documented.
```

---

### Task 10: Give the hillclimber Engel's real mutation operator

**Why this task exists:** Task 9 made the objective correct (unclued runs now cost `uncluedRun`), and convergence got *worse*: 0/30 masks pass `deriveSlots` at 15×15, ~1% at 9×9, confirmed as a genuine local-optimum stall (10× budget produced identical penalties).

The objective is right; the search is too weak. Engel 2009 §3.4 measured this exact failure: **k = 1 is the worst mutation size he tested**, and the best is k drawn uniformly from {2, 3} (his Figure 3.9, thirty 20×20 masks per setting). His explanation is our situation verbatim — *"changing two or more adjacent fields often helps overcoming a local optimum"* — and in §3.3 he notes that structural problems needing several coordinated changes are *"a good example for a local minimum"* that a fitness penalty alone resolves only *"fairly ineffectively"*.

`generateMask` currently mutates exactly one cell, drawn uniformly, with the new field type drawn uniformly over all 9 arrow options. That is the strawman version of Engel's operator. This task implements the real one.

Three changes, all inside the mutation step — deliberately one group of variables so the effect is measurable:

| | Current | Engel |
|---|---|---|
| Mutation size | k = 1 | k ∈ {2, 3} |
| Placement | one uniform cell | k cells clustered around a central point (σ ≈ 3) |
| Field types | uniform over 9 | ~2/3 Letter; straight arrows twice as likely as bent |

**Files:**
- Modify: `grid_generator/mask.js`
- Modify: `test/mask.test.js`
- Modify: `test/generate.integration.test.js` (seed may change)

**Interfaces:**
- Produces: `randomCellKind(rng)` (replaces the uniform `randomArrows` draw at mutation and init sites); `pickMutationCells(mask, rng)` → array of 2–3 cell indices; `generateMask` unchanged in signature and still deterministic per rng.
- `randomArrows` stays exported and unchanged — `randomCellKind` uses it for the pair case.

- [ ] **Step 1: Write the failing tests**

```js
// append to test/mask.test.js

test('randomCellKind draws Letter about two thirds of the time and favours straight arrows', function () {
  // Engel 3.4: a typical mask is ~2/3 letter fields, and single straight
  // definitions are twice as likely as bent ones. Exact ratios are tuning
  // values; this asserts the shape of the distribution, not precise numbers.
  var rng = mask.mulberry32(11);
  var letters = 0, straightSingle = 0, bentSingle = 0, pairs = 0;
  for (var i = 0; i < 6000; i++) {
    var cell = mask.randomCellKind(rng);
    if (cell.kind === 'L') { letters++; continue; }
    if (cell.arrows.length === 2) { pairs++; continue; }
    if (cell.arrows[0] === 'R' || cell.arrows[0] === 'B') straightSingle++;
    else bentSingle++;
  }
  assert.ok(letters > 3300 && letters < 4700, 'letters ~2/3, got ' + letters + '/6000');
  assert.ok(straightSingle > bentSingle, 'straight singles should beat bent: ' + straightSingle + ' vs ' + bentSingle);
  assert.ok(pairs > 0, 'pairs must still be reachable');
});

test('pickMutationCells returns 2 or 3 distinct in-bounds cells', function () {
  var rng = mask.mulberry32(5);
  var m = mask.generateMask(9, 9, mask.mulberry32(5));
  for (var i = 0; i < 500; i++) {
    var picked = mask.pickMutationCells(m, rng);
    assert.ok(picked.length === 2 || picked.length === 3, 'k must be 2 or 3, got ' + picked.length);
    assert.strictEqual(new Set(picked).size, picked.length, 'cells must be distinct');
    picked.forEach(function (idx) {
      assert.ok(idx >= 0 && idx < m.cells.length, 'in bounds: ' + idx);
    });
  }
});

test('pickMutationCells keeps its cells near each other', function () {
  // Engel 3.4: two distant changes are uncorrelated, and an uncorrelated pair
  // is far more likely to hurt than help - so the cells cluster (sigma ~ 3).
  var rng = mask.mulberry32(7);
  var m = mask.generateMask(15, 15, mask.mulberry32(7));
  var far = 0, total = 0;
  for (var i = 0; i < 500; i++) {
    var picked = mask.pickMutationCells(m, rng);
    var c0 = picked[0] % m.nbLines, r0 = (picked[0] - c0) / m.nbLines;
    for (var j = 1; j < picked.length; j++) {
      var c = picked[j] % m.nbLines, r = (picked[j] - c) / m.nbLines;
      total++;
      if (Math.abs(c - c0) > 9 || Math.abs(r - r0) > 9) far++;
    }
  }
  assert.ok(far / total < 0.05, 'clustered draws should rarely exceed 3 sigma, got ' + far + '/' + total);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test test/mask.test.js`
Expected: FAIL — `randomCellKind` / `pickMutationCells` are not exported.

- [ ] **Step 3: Implement the operator**

Add to `grid_generator/mask.js`, next to `randomArrows`:

```js
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
```

Export `randomCellKind` and `pickMutationCells`.

- [ ] **Step 4: Rewire `generateMask` to use them**

Replace the initialization draw and the whole mutation block. The initial fill becomes:

```js
  var cells = [];
  for (var i = 0; i < nbLines * nbColumns; i++) cells.push(randomCellKind(rng));
```

(`options.defRatio` is now unused — delete it from the options handling and from the docstring; `randomCellKind` owns the letter/definition balance. Leave `maxStale` and `maxIterations` as they are.)

The mutation block becomes:

```js
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
```

- [ ] **Step 5: Run tests**

Run: `node --test test/mask.test.js`
Expected: the three new tests pass. The Task 4/9 convergence canary will very likely fail again — its seeds are re-derived in Step 6, do not delete the test.

- [ ] **Step 6: Measure convergence, and raise the budget if that is what is missing**

```bash
node -e "
var mask = require('./grid_generator/mask');
[9, 13, 15].forEach(function (n) {
  [5000, 20000, 60000].forEach(function (stale) {
    var ok = 0, t0 = Date.now();
    for (var s = 1; s <= 40; s++) {
      var m = mask.generateMask(n, n, mask.mulberry32(s), { maxStale: stale });
      if (mask.deriveSlots(m)) ok++;
    }
    console.log(n + 'x' + n + ' maxStale=' + stale + ': ' + ok + '/40 valid, ' + (Date.now() - t0) + 'ms total');
  });
});
"
```

Report the full table. Engel's runs used millions of evaluations per mask; ours were stopping after a few tens of thousands, so a higher `maxStale` is legitimate here — but only raise the **default** if the table shows it actually buys convergence. A hillclimb that costs a second and succeeds beats thirty that cost 143ms and fail.

Then update the canary test in `test/mask.test.js` with three seeds that converge, and its comment with the new measured rate.

- [ ] **Step 7: Full suite**

Run: `pnpm test`
Expected: green. If the real-dictionary integration test's seed no longer yields a valid grid, re-derive it (seeds 1..40, `generate(9, 9, dictionary, {seed: s, maxMaskAttempts: 5})`) and update it.

- [ ] **Step 8: Real 15×15**

Run: `node scripts/generate-grid.js 15 15` (foreground, up to 10 minutes).
Record wall time, how many attempts passed `deriveSlots`, the winning mask penalty, and the word count.

If 15×15 now works, also try `node scripts/generate-grid.js 13 15` and report whether rectangles behave.

If it still fails, report DONE_WITH_CONCERNS with the numbers, and say specifically whether masks now pass `deriveSlots` (search fixed, fill is the bottleneck) or still do not (search still too weak). Do **not** weaken `validate.js` and do **not** inflate `fill.solve` budgets to force a pass — the next lever is Engel's guided mutation (tournament on local penalty) plus his shift/split predefined mutations, which is a separate task.

- [ ] **Step 9: Commit**

```bash
git add grid_generator/mask.js test/mask.test.js test/generate.integration.test.js
git commit -m "fix: mutate 2-3 clustered cells instead of one uniform cell"
```

Full commit body:

```
fix: mutate 2-3 clustered cells instead of one uniform cell

The hillclimber was using the exact mutation operator Engel 2009 measured
as the worst of the ones he tried: k=1, drawn uniformly, with the new
field type uniform over every arrow option. Escaping a local optimum in a
crossword mask normally needs two or three coordinated changes, so a lone
flip could not make one - which is why the corrected objective from the
previous commit left 0/30 masks valid at 15x15.

Now k is drawn from {2,3} and the cells cluster around a central point
(sigma ~ 3), since two distant changes are uncorrelated and an
uncorrelated pair is likelier to hurt than help. Field types are drawn
with Engel's rough proportions - about two thirds letters, straight
arrows twice as likely as bent - instead of uniformly, which had been
producing far too many double-definition cells.
```

---

### Task 11: Retune the penalty barème against measured GSO structure

**Why this task exists:** Task 10 made the generator work — a real 15×15 now generates, validates, and fills with genuine French words in ~56s. But its *shape* does not match real grids. Measured over 51 real GSO grids against the first generated 15×15:

| Measure | Real GSO (51 grids) | Generated 15×15 |
|---|---|---|
| Straight **vertical** definition run | **never exceeds 1** (100% are length 1) | **7** |
| Straight **horizontal** definition run | max 2 (1×94%, 2×6%) | 2 ✓ |
| 8-connected definition cluster | max 3 (1×81%, 2×17%, 3×2%) | **13** |
| Definition density | 19.0% avg (17.8–21.1) | 21% ✓ |
| Word length mix | 2:16% 3:17% 4:21% 5:15% 6:10% 7:4% 8:5% 9:7% 10:5% | — |

A column of seven stacked definition cells is exactly the "bande de définitions sur un côté" the user reported on the previous generator. Nothing in the current barème forbids it: the cluster term charges by size and extension, and the optimizer simply pays it.

The word-length table is wrong for this dictionary too. It is Engel's, tuned on German *Schwedenrätsel*, and charges 650 for a 2-letter word — but 2-letter words are **16% of all words in real GSO grids**. Spec §12 anticipated exactly this: *"Barème de pénalités mal réglé pour notre dico français … Réglage empirique après premier run réel."* This is that retune.

Nothing structural changes. Weights only, plus one new penalty family for straight definition chains.

**Files:**
- Modify: `grid_generator/mask.js`
- Modify: `test/mask.test.js`
- Modify: `test/generate.integration.test.js` (seed may change)

**Interfaces:**
- Produces: `DEFAULT_WEIGHTS.defRunH`, `DEFAULT_WEIGHTS.defRunV` (new); retuned `DEFAULT_WEIGHTS.wordLength` and `DEFAULT_WEIGHTS.clusterBase`. No signature changes.

- [ ] **Step 1: Write the failing tests**

```js
// append to test/mask.test.js
// NOTE: also add `defRunH: 0, defRunV: 0` to zeroWeights() so the existing
// per-penalty isolation tests keep measuring only their own term.

test('scoreMask: two vertically stacked description cells are penalized', function () {
  var w = zeroWeights(); w.defRunV = 900;
  // 1 wide, 2 tall: a vertical definition run of length 2. Real GSO grids
  // never do this - 100% of their vertical definition runs are length 1.
  assert.strictEqual(mask.scoreMask(M(1, 2, [D('R'), D('R')]), w), 900);
});

test('scoreMask: vertical description runs cost more the longer they get', function () {
  var w = zeroWeights(); w.defRunV = 900;
  var two = mask.scoreMask(M(1, 2, [D('R'), D('R')]), w);
  var three = mask.scoreMask(M(1, 3, [D('R'), D('R'), D('R')]), w);
  assert.ok(three > two * 1.5, 'length 3 must cost superlinearly more than length 2: ' + three + ' vs ' + two);
});

test('scoreMask: a lone description cell costs no chain penalty', function () {
  var w = zeroWeights(); w.defRunV = 900; w.defRunH = 900;
  assert.strictEqual(mask.scoreMask(M(1, 1, [D('R')]), w), 0);
});

test('scoreMask: two side-by-side description cells are free, three are not', function () {
  var w = zeroWeights(); w.defRunH = 900;
  // Real GSO grids do reach horizontal runs of 2 (6% of the time) but never 3.
  assert.strictEqual(mask.scoreMask(M(2, 1, [D('B'), D('B')]), w), 0);
  assert.ok(mask.scoreMask(M(3, 1, [D('B'), D('B'), D('B')]), w) > 0);
});

test('scoreMask: two-letter words are only mildly penalized', function () {
  // Engel charged 650 here, tuned on German puzzles. Real GSO grids make 16%
  // of their words two letters long, so this must not be a near-veto.
  assert.ok(mask.DEFAULT_WEIGHTS.wordLength[2] < 150,
    'length-2 penalty should be mild, got ' + mask.DEFAULT_WEIGHTS.wordLength[2]);
  assert.ok(mask.DEFAULT_WEIGHTS.wordLength[2] > mask.DEFAULT_WEIGHTS.wordLength[4],
    'length 4 should still be preferred over length 2');
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test test/mask.test.js`
Expected: the chain tests FAIL (no `defRunH`/`defRunV` term), and the length-2 assertion FAILS (it is 650).

- [ ] **Step 3: Implement the straight-chain penalty**

Add to `grid_generator/mask.js`, next to `clusterPenalty`:

```js
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
```

Add it to `scoreMask`'s total alongside `clusterPenalty` and `uncluedRunPenalty`.

- [ ] **Step 4: Retune the weights**

In `DEFAULT_WEIGHTS`:

```js
  // Retuned against 51 real GSO grids (see defRunPenalty and the word-length
  // note below); the previous values were Engel's, measured on German
  // Schwedenraetsel, and did not describe this provider's grids.
  defRunH: 900,
  defRunV: 900,
```

Replace the word-length table. Real GSO frequencies are 2:16% 3:17% 4:21% 5:15% 6:10% 7:4% 8:5% 9:7% 10:5%, so lengths 2-6 are all ordinary and only the extremes deserve real cost. Keep length 0/1 as hard violations, and keep raising the cost past 10 — those are rare, and long words are the hardest for `fill.solve` to satisfy:

```js
  wordLength: [2000, 1500, 60, 20, 0, 0, 10, 40, 50, 60, 80, 180, 300, 450, 650, 900],
```

Retune `clusterBase` so it stops at what real grids actually contain (max 3), rather than treating 4-7 as merely expensive:

```js
  clusterBase: [0, 0, 60, 260, 900, 1600, 2400, 3400],
```

Leave every other weight alone — this task changes chain, length and cluster costs only.

- [ ] **Step 5: Re-measure convergence**

```bash
node -e "
var mask = require('./grid_generator/mask');
[9, 13, 15].forEach(function (n) {
  var ok = 0, t0 = Date.now();
  for (var s = 1; s <= 40; s++) {
    if (mask.deriveSlots(mask.generateMask(n, n, mask.mulberry32(s)))) ok++;
  }
  console.log(n + 'x' + n + ': ' + ok + '/40 valid, ' + (Date.now() - t0) + 'ms');
});
"
```

Report the table. A retune that makes masks prettier but unreachable is a regression — if convergence collapses (say below 5/40 at 15×15), soften `defRunV`/`defRunH` toward 500 and report both tables rather than shipping a generator that cannot generate.

Update the canary test seeds in `test/mask.test.js` and its comment with the new measured rate.

- [ ] **Step 6: Full suite**

Run: `pnpm test`
Expected: green. Re-derive the integration test seed if needed (seeds 1..40, `generate(9, 9, dictionary, {seed: s, maxMaskAttempts: 5})`).

- [ ] **Step 7: Generate and measure a real 15×15 against the GSO table**

Run: `node scripts/generate-grid.js 15 15` (foreground, up to 10 minutes), then measure its structure:

```bash
node -e "
var fs = require('fs');
var enums = require('./game_files/enums');
var g = JSON.parse(fs.readFileSync('data/generated-grid.json', 'utf8'));
var W = g.nbLines, H = g.nbColumns;
var isDef = function (i) { return g.cases[i].type === enums.CaseType.Description; };
var maxH = 0, maxV = 0, defs = 0, r, c, run;
for (var i = 0; i < g.cases.length; i++) if (isDef(i)) defs++;
for (r = 0; r < H; r++) { run = 0; for (c = 0; c < W; c++) { if (isDef(r*W+c)) { run++; if (run>maxH) maxH=run; } else run = 0; } }
for (c = 0; c < W; c++) { run = 0; for (r = 0; r < H; r++) { if (isDef(r*W+c)) { run++; if (run>maxV) maxV=run; } else run = 0; } }
var seen = new Array(g.cases.length).fill(false), maxClus = 0;
for (var s = 0; s < g.cases.length; s++) {
  if (seen[s] || !isDef(s)) continue;
  var q = [s], n = 0; seen[s] = true;
  while (q.length) { var idx = q.pop(); n++;
    var col = idx % W, row = (idx - col) / W;
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      var rr = row+dr, cc = col+dc;
      if (rr<0||cc<0||rr>=H||cc>=W) continue;
      var nn = rr*W+cc;
      if (!seen[nn] && isDef(nn)) { seen[nn] = true; q.push(nn); }
    } }
  if (n > maxClus) maxClus = n;
}
console.log('longest straight def run H' + maxH + ' V' + maxV + ' | max cluster ' + maxClus + ' | density ' + Math.round(defs/g.cases.length*100) + '%');
"
```

**Acceptance targets, from the real-grid table:** longest vertical definition run ≤ 2, longest horizontal ≤ 2, max 8-connected cluster ≤ 4, density 17–23%. Report the measured line against these. Being one over on a single measure is a reportable near-miss, not a failure — say so plainly rather than re-rolling seeds until a pretty grid appears.

- [ ] **Step 8: Commit**

```bash
git add grid_generator/mask.js test/mask.test.js test/generate.integration.test.js
git commit -m "tune: match the penalty barème to measured GSO grid structure"
```

Full commit body:

```
tune: match the penalty barème to measured GSO grid structure

The barème was Engel's, measured on German Schwedenraetsel, and it does
not describe this provider's grids. Across 51 real GSO grids: vertical
runs of adjacent definition cells are always length 1, horizontal runs
reach 2 only 6% of the time and never 3, definition clusters never
exceed 3 cells, and two-letter words are 16% of all words - which the
old table charged 650 for, nearly a veto.

Nothing forbade a straight stack of definitions, so the optimizer bought
one: the first generated 15x15 had a column of seven, the same "band of
definitions down one side" the previous generator was reported for. The
new defRunH/defRunV terms charge straight chains quadratically past the
length real grids tolerate, and the word-length and cluster tables now
follow the measured frequencies.
```

---

### Task 12: Pick the best mask in the pool, not the first one that fills

**Why this task exists:** Task 11 retuned the barème, and the generator reliably produces valid, playable 15×15 grids. But structural quality is a lottery. Measured over 8 real generations (seeds 101–108) after the retune:

```
seed 101: H3 V2 cluster4 dens24%  MISS      seed 105: H2 V2 cluster3 dens23%  OK
seed 102: H3 V2 cluster5 dens23%  MISS      seed 106: H3 V2 cluster4 dens24%  MISS
seed 103: H3 V2 cluster6 dens24%  MISS      seed 107: H2 V3 cluster5 dens24%  MISS
seed 104: H3 V2 cluster3 dens22%  MISS      seed 108: H3 V2 cluster6 dens24%  MISS
```

**1/8 met all four structural targets** (H ≤ 2, V ≤ 2, cluster ≤ 4, density 17–23%). All 8 generated successfully, so this is purely about quality, not function.

The cause is in `scripts/generate-grid.js`. `generate()` hillclimbs a mask, and if it fills, **returns it immediately**. `mask.penalty` — the number that measures exactly this structural quality, now calibrated against 51 real GSO grids — is computed, passed to `onAttempt` for logging, and then thrown away. Nothing ever compares two masks. The grid you get is whichever mask happened to fill first, not the best one available.

Fixing this is free in quality terms: collect the valid masks, sort them by penalty ascending, and fill them best-first. The first fill that succeeds is then the best-structured mask that is actually fillable. Raising penalty weights instead would be the wrong lever — Task 11 measured that pushing `defRun*` to 900 collapsed convergence from 4/15 to 1/15.

The time budget allows it: spec §1 states this generator runs offline, once per grid (a daily cron), never on a player request path.

**Files:**
- Modify: `scripts/generate-grid.js`
- Modify: `test/generate.test.js`

**Interfaces:**
- `generate(nbLines, nbColumns, dictionary, options)` keeps its signature. New options: `maskPoolSize` (default 8), `maxMaskAttempts` default raised 30 → 60.
- `options.onAttempt(n, total, nbSlots, penalty)` is unchanged and still fires per *valid* mask found during collection.
- New optional `options.onSelect(poolSize, rank, penalty)` — fires once per fill attempt, so the CLI can show that selection is happening.

- [ ] **Step 1: Write the failing tests**

```js
// append to test/generate.test.js

test('generate fills the lowest-penalty mask in the pool first', function () {
  // Three stub masks with known penalties, handed to generate via a stubbed
  // mask library is not reachable from here - so this asserts the observable
  // consequence instead: onSelect reports strictly increasing penalties,
  // i.e. the pool really was tried in ascending order.
  var dico = dictionary.buildDictionary([{ word: 'ABC', definitions: ['x'] }]);
  var seen = [];
  generateGrid.generate(9, 9, dico, {
    seed: 3, maxMaskAttempts: 25, maskPoolSize: 4, maxStale: 800,
    maxBacktracks: 50, timeoutMs: 1500,
    onSelect: function (poolSize, rank, penalty) { seen.push(penalty); }
  });
  // the dictionary cannot fill anything, so every pooled mask is attempted
  for (var i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1],
      'pool must be tried in ascending penalty order, got ' + seen.join(','));
  }
});

test('generate stops collecting masks once the pool is full', function () {
  var dico = dictionary.buildDictionary([{ word: 'ABC', definitions: ['x'] }]);
  var found = 0;
  generateGrid.generate(9, 9, dico, {
    seed: 3, maxMaskAttempts: 60, maskPoolSize: 2, maxStale: 800,
    maxBacktracks: 50, timeoutMs: 1500,
    onAttempt: function () { found++; }
  });
  assert.ok(found <= 2, 'collection must stop at maskPoolSize, collected ' + found);
});

test('generate still returns null when nothing in the pool can be filled', function () {
  var dico = dictionary.buildDictionary([{ word: 'ABC', definitions: ['x'] }]);
  var grid = generateGrid.generate(9, 9, dico, {
    seed: 1, maxMaskAttempts: 10, maskPoolSize: 2, maxStale: 800,
    maxBacktracks: 50, timeoutMs: 1500
  });
  assert.strictEqual(grid, null);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test test/generate.test.js`
Expected: the ordering and pool-cap tests FAIL (`onSelect` never fires; collection does not stop at `maskPoolSize`).

- [ ] **Step 3: Implement**

Replace the body of `generate()`'s loop in `scripts/generate-grid.js`. Collect first, then fill best-first:

```js
  // The mask penalty measures exactly the structural quality we want - it is
  // calibrated against 51 real GSO grids - so the mask that fills first is not
  // the mask we want, it is merely the luckiest. Measured over 8 real 15x15
  // generations, taking the first fillable mask met all four structural
  // targets 1 time in 8. Collect the valid masks, then try them in ascending
  // penalty order: the first one that fills is the best-structured mask that
  // is actually fillable. Raising the penalty weights instead is the wrong
  // lever - Task 11 measured that it collapses convergence.
  var pool = [];
  for (var attempt = 0; attempt < maxMaskAttempts && pool.length < maskPoolSize; attempt++) {
    var mask = maskLib.generateMask(nbLines, nbColumns, rng, {
      weights: options.weights,
      maxStale: options.maxStale
    });
    var slots = maskLib.deriveSlots(mask);
    if (!slots) continue; // hillclimber went stale on an invalid mask - next seed
    if (options.onAttempt) options.onAttempt(attempt + 1, maxMaskAttempts, slots.length, mask.penalty);
    pool.push({ mask: mask, slots: slots });
  }

  pool.sort(function (a, b) { return a.mask.penalty - b.mask.penalty; });

  for (var i = 0; i < pool.length; i++) {
    if (options.onSelect) options.onSelect(pool.length, i + 1, pool[i].mask.penalty);

    var assignment = fillLib.solve(pool[i].slots, dictionary, {
      maxBacktracks: options.maxBacktracks,
      timeoutMs: options.timeoutMs
    });
    if (!assignment) continue;

    var grid = exporterLib.exportGrid(pool[i].mask, pool[i].slots, assignment, dictionary);
    if (validateLib.validateGrid(grid, dictionary).valid) return grid;
  }
  return null;
```

(Use whatever local name the file already gives the export module — do not rename it.)

Add the two new options near `maxMaskAttempts`:

```js
  // 60 attempts yields roughly 8 valid masks at 15x15 (about a quarter of
  // attempts converge), which is enough spread for the penalty sort to have
  // something to choose between without the collection phase dominating.
  var maxMaskAttempts = options.maxMaskAttempts !== undefined ? options.maxMaskAttempts : 60;
  var maskPoolSize = options.maskPoolSize !== undefined ? options.maskPoolSize : 8;
```

- [ ] **Step 4: Show selection in the CLI**

In the `require.main === module` block, add an `onSelect` alongside the existing `onAttempt`:

```js
    onSelect: function (poolSize, rank, penalty) {
      console.log('Remplissage du masque ' + rank + '/' + poolSize + ' (penalite ' + penalty + ')...');
    },
```

- [ ] **Step 5: Full suite**

Run: `pnpm test`
Expected: green. The integration test may need its seed re-derived — its options should also get `maskPoolSize: 2` and a modest `maxMaskAttempts` so it stays under ~30s.

- [ ] **Step 6: Measure the same 8 seeds, before and after**

Re-run the exact measurement that motivated this task, so the comparison is like-for-like:

```bash
node -e "
var fs = require('fs');
var enums = require('./game_files/enums');
var dictionaryLib = require('./grid_generator/dictionary');
var lexLib = require('./grid_generator/lexiqueFrequency');
var gen = require('./scripts/generate-grid');
var dictionary = dictionaryLib.buildDictionary(
  JSON.parse(fs.readFileSync('data/dico.json','utf8')),
  lexLib.buildFrequencyMap(fs.readFileSync('data/Lexique4.tsv','utf8')));
function struct(g) {
  var W=g.nbLines,H=g.nbColumns,isDef=function(i){return g.cases[i].type===enums.CaseType.Description;};
  var maxH=0,maxV=0,defs=0,r,c,run;
  for (var i=0;i<g.cases.length;i++) if (isDef(i)) defs++;
  for (r=0;r<H;r++){run=0;for(c=0;c<W;c++){if(isDef(r*W+c)){run++;if(run>maxH)maxH=run;}else run=0;}}
  for (c=0;c<W;c++){run=0;for(r=0;r<H;r++){if(isDef(r*W+c)){run++;if(run>maxV)maxV=run;}else run=0;}}
  var seen=new Array(g.cases.length).fill(false),maxC=0;
  for (var s=0;s<g.cases.length;s++){
    if(seen[s]||!isDef(s))continue;
    var q=[s],n=0;seen[s]=true;
    while(q.length){var idx=q.pop();n++;var col=idx%W,row=(idx-col)/W;
      for(var dr=-1;dr<=1;dr++)for(var dc=-1;dc<=1;dc++){
        var rr=row+dr,cc=col+dc;
        if(rr<0||cc<0||rr>=H||cc>=W)continue;
        var nn=rr*W+cc;
        if(!seen[nn]&&isDef(nn)){seen[nn]=true;q.push(nn);}}}
    if(n>maxC)maxC=n;}
  return {maxH:maxH,maxV:maxV,maxC:maxC,dens:Math.round(defs/g.cases.length*100)};
}
var ok=0,tot=0;
for (var seed=101; seed<=108; seed++){
  var t0=Date.now();
  var g=gen.generate(15,15,dictionary,{seed:seed});
  var dt=((Date.now()-t0)/1000).toFixed(0);
  if(!g){console.log('seed '+seed+': FAILED ('+dt+'s)');tot++;continue;}
  var s=struct(g);
  var pass=s.maxH<=2&&s.maxV<=2&&s.maxC<=4&&s.dens>=17&&s.dens<=23;
  if(pass)ok++; tot++;
  console.log('seed '+seed+': H'+s.maxH+' V'+s.maxV+' cluster'+s.maxC+' dens'+s.dens+'% '+dt+'s '+(pass?'OK':'MISS'));
}
console.log('meets all structural targets: '+ok+'/'+tot);
"
```

This takes several minutes — run it in the **foreground** with a generous timeout, and do not launch background scans.

Report the before (1/8) and after numbers, and the wall-time change. Success here is a clear majority passing. If it barely moves, say so plainly and report which measure still dominates the misses — do not re-roll seeds to find a better-looking set.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-grid.js test/generate.test.js test/generate.integration.test.js
git commit -m "fix: fill the best mask in the pool, not the first one that fills"
```

Full commit body:

```
fix: fill the best mask in the pool, not the first one that fills

generate() hillclimbed a mask and returned it the moment it filled, so
the grid you got was whichever mask was luckiest, not the best one
available - mask.penalty was computed, logged, and then discarded. Over
8 real 15x15 generations only 1 met all four structural targets, with
horizontal definition chains of 3 in six of them and clusters up to 6.

Now the valid masks are collected into a pool, sorted by penalty, and
filled best-first, so the result is the best-structured mask that is
actually fillable. Raising the penalty weights would have been the wrong
lever: that was measured to collapse convergence.
```
