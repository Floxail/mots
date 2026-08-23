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
  // 2 wide x 3 tall. Column 1 holds a 3-cell vertical run (rows 0-2). The
  // description at index 2 points RB (code 1): start right, run down - so its
  // word begins at index 3, one cell INTO that run, and is therefore not the
  // maximal run the player actually sees.
  var g = { nbLines: 2, nbColumns: 3, cases: [
    { type: enums.CaseType.Letter, value: 'A' },
    { type: enums.CaseType.Letter, value: 'B' },
    { type: enums.CaseType.Description, nbDesc: 1, desc: ['d'], arrow: [1] },
    { type: enums.CaseType.Letter, value: 'C' },
    { type: enums.CaseType.Letter, value: 'D' },
    { type: enums.CaseType.Letter, value: 'E' }
  ] };
  var r = validate.validateGrid(g);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(function (e) { return e.indexOf('non maximal') !== -1; }),
    'expected a "non maximal" error, got ' + JSON.stringify(r.errors));
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
