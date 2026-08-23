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

function zeroWeights() {
  return {
    uncovered: 0, singleCovered: 0, singleCoveredEnclosed: 0, overlap: 0,
    wordLength: new Array(16).fill(0), wordLengthBeyond: 0,
    unenclosedStart: 0, deadEnd: 0,
    clusterBase: new Array(8).fill(0), clusterBeyond: 0,
    longCrossLen: 6, uncluedRun: 0,
    defRunH: 0, defRunV: 0
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
  // (uncovered cells at 1500, overlaps at 600, sub-2-letter words, and now
  // unclued runs at 1500) before going stale - these seeds are a regression
  // canary, not a proof.
  //
  // Investigation note (Task 4): seeds 1, 2 and 3 from the brief do NOT
  // converge to a valid mask, even at maxStale=200000/maxIterations=5e6
  // (no change beyond ~5-15k iterations - a genuine strict local optimum,
  // not an under-budgeted search). Exhaustively re-scoring every single-cell
  // mutation from the stuck states confirms scoreMask/deriveWords/deriveSlots
  // compute correctly and consistently: e.g. for seed 1 the stuck DEF cell's
  // best own-cell alternative really does score higher than staying put,
  // because fixing it locally uncovers a neighbor that only that cell's
  // word was covering. A strict-improvement-only, single-cell-mutation
  // hillclimber cannot execute the two-cell move such traps require - a
  // structural property of this search (no bug found in scoring). Scanning
  // seeds 1-30 at maxStale=20000, only 3/30 converge (6, 12, 25).
  //
  // Task 9 update: scoreMask/deriveSlots now also penalize/reject unclued
  // maximal runs (the actual validateGrid rule - see mask.js scanRuns), and
  // generateMask accepts equal-penalty plateau moves to help escape local
  // optima. Both changes make the landscape strictly harder to satisfy (a
  // mask now has to be genuinely valid, not just "every cell covered"), so
  // the old canary seeds (6, 12, 25) no longer converge - re-scanning at
  // default budget (maxStale=5000) over seeds 1-300 found only 3 valid:
  // 86, 131, 289 (1%, down from 10% pre-fix at maxStale=20000). This drop
  // is expected and matches Task 8's finding that the pre-fix objective was
  // far too permissive (~98% of its "valid" masks failed validateGrid);
  // this canary now exercises the real, harder constraint end-to-end.
  //
  // Task 10 update: the k=1 uniform mutation was itself the bottleneck
  // (Engel 2009 3.4 measured it as his worst setting). Switching to k in
  // {2,3} clustered cells with non-uniform field types, and raising the
  // default maxStale from 5000 to 60000 (justified by the Step 6 table in
  // task-10-report.md - convergence keeps climbing with budget at every
  // grid size), lifted the 9x9 rate from 1% to 150/300 (50%) over seeds
  // 1-300. Re-picked canary seeds: 1, 4, 5.
  //
  // Task 11 update: adding defRunH/defRunV (see DEFAULT_WEIGHTS) makes the
  // landscape harder again - straight definition chains that used to be
  // free now cost real penalty - so seed 5 stopped converging. Re-scanned
  // seeds 1-60 at default budget: 22/60 (37%) converge, down from ~50% but
  // still healthy; the drop is the expected cost of forbidding the
  // "band of definitions" defect the retune exists to fix (see
  // task-11-report.md). Re-picked canary seeds: 1, 3, 4.
  //
  // Final-review update: ARROW_PAIRS dropped the unobserved B+BR combination
  // (see the comment on ARROW_PAIRS in mask.js), which changes what
  // randomCellKind draws and so which seeds converge - seed 3 stopped
  // converging. Re-scanned seeds 1-40 at default budget: 15/40 (37.5%)
  // converge, matching the pre-fix rate. Re-picked canary seeds: 1, 4, 5.
  [1, 4, 5].forEach(function (seed) {
    var m = mask.generateMask(9, 9, mask.mulberry32(seed));
    assert.notStrictEqual(mask.deriveSlots(m), null, 'seed ' + seed);
  });
});

test('generateMask: converged 15x15 mask is valid (product-size canary)', function () {
  // Spec section 11 asks for a convergence canary at the product target size
  // (13x13/15x15), not just 9x9. Scanned seeds 1-40 at default budget
  // (maxStale 60000): 5/40 converge (13, 15, 26, 31, 40); seed 31 is the
  // fastest at ~5s, well under this test's budget.
  var m = mask.generateMask(15, 15, mask.mulberry32(31));
  assert.notStrictEqual(mask.deriveSlots(m), null, 'seed 31');
});

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
