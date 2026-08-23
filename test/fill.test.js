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
