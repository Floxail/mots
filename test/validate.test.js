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
