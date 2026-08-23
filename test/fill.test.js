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
  // A full 3x3 word square (6 length-3 slots, every cell shared by one H and
  // one V slot) against a dictionary that admits plenty of locally-consistent
  // partial placements but no global solution - unlike the old 1-crossing
  // pair here, this genuinely needs real search before concluding UNSAT, so
  // it actually exercises maxBacktracks instead of exhausting on its own in
  // ~2 backtracks regardless of budget.
  function slot(cells, crossings) { return { axis: 'H', cells: cells, length: 3, crossings: crossings }; }
  var slots = [
    slot([0, 1, 2], [{ slotIndex: 3, ownPos: 0, otherPos: 0 }, { slotIndex: 4, ownPos: 1, otherPos: 0 }, { slotIndex: 5, ownPos: 2, otherPos: 0 }]),
    slot([3, 4, 5], [{ slotIndex: 3, ownPos: 0, otherPos: 1 }, { slotIndex: 4, ownPos: 1, otherPos: 1 }, { slotIndex: 5, ownPos: 2, otherPos: 1 }]),
    slot([6, 7, 8], [{ slotIndex: 3, ownPos: 0, otherPos: 2 }, { slotIndex: 4, ownPos: 1, otherPos: 2 }, { slotIndex: 5, ownPos: 2, otherPos: 2 }]),
    slot([0, 3, 6], [{ slotIndex: 0, ownPos: 0, otherPos: 0 }, { slotIndex: 1, ownPos: 1, otherPos: 0 }, { slotIndex: 2, ownPos: 2, otherPos: 0 }]),
    slot([1, 4, 7], [{ slotIndex: 0, ownPos: 0, otherPos: 1 }, { slotIndex: 1, ownPos: 1, otherPos: 1 }, { slotIndex: 2, ownPos: 2, otherPos: 1 }]),
    slot([2, 5, 8], [{ slotIndex: 0, ownPos: 0, otherPos: 2 }, { slotIndex: 1, ownPos: 1, otherPos: 2 }, { slotIndex: 2, ownPos: 2, otherPos: 2 }])
  ];
  var words = ['ABC', 'ABD', 'ABE', 'ACD', 'ACE', 'ADE', 'BCD', 'BCE', 'BDE', 'CDE',
    'AXY', 'BXY', 'CXY', 'DXY', 'EXY', 'XYZ'];

  // Measured locally: uncapped, this scenario takes 33 backtracks to exhaust
  // and correctly returns null (no 3x3 square exists in this word set).
  // Capping at 5 must cut that off much earlier - the loop-unwind after a
  // budget hit adds a small, bounded overshoot per stack frame, observed at
  // 7 here, well short of 33.
  var uncappedStats = {};
  var uncapped = fill.solve(slots, dico(words), { stats: uncappedStats });
  assert.strictEqual(uncapped, null);
  assert.ok(uncappedStats.backtracks > 20,
    'uncapped scenario must need real search, got ' + uncappedStats.backtracks + ' backtracks');

  var cappedStats = {};
  var capped = fill.solve(slots, dico(words), { maxBacktracks: 5, stats: cappedStats });
  assert.strictEqual(capped, null);
  assert.ok(cappedStats.backtracks <= 8,
    'maxBacktracks:5 must cut the search off early, got ' + cappedStats.backtracks + ' backtracks');
  assert.ok(cappedStats.backtracks < uncappedStats.backtracks,
    'the cap must actually reduce backtracks: capped ' + cappedStats.backtracks + ' vs uncapped ' + uncappedStats.backtracks);
});
