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
