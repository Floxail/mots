var test = require('node:test');
var assert = require('node:assert');
var enums = require('../game_files/enums');
var extractWords = require('../grid_generator/extractWords');

function letterCase(value) { return { type: enums.CaseType.Letter, value: value }; }
function emptyCase() { return { type: enums.CaseType.Empty }; }
function descCase(descArray) { return { type: enums.CaseType.Description, desc: descArray, nbDesc: descArray.length }; }

test('extracts a horizontal-only word from a single-row grid', function () {
  var grid = {
    nbLines: 4,
    nbColumns: 1,
    cases: [descCase(['Boit du the']), letterCase('T'), letterCase('H'), letterCase('E')]
  };
  var pairs = extractWords.extractWordDefPairs(grid);
  assert.deepStrictEqual(pairs, [{ word: 'THE', definition: 'Boit du the' }]);
});

test('extracts a vertical-only word when there is no letter to the right', function () {
  var grid = {
    nbLines: 2,
    nbColumns: 3,
    cases: [
      descCase(['Negation']), emptyCase(),
      letterCase('N'), emptyCase(),
      letterCase('O'), emptyCase()
    ]
  };
  var pairs = extractWords.extractWordDefPairs(grid);
  assert.deepStrictEqual(pairs, [{ word: 'NO', definition: 'Negation' }]);
});

test('pairs desc[0] with the horizontal word and desc[1] with the vertical word', function () {
  var grid = {
    nbLines: 3,
    nbColumns: 3,
    cases: [
      descCase(['Across def', 'Down def']), letterCase('A'), letterCase('B'),
      letterCase('X'), emptyCase(), emptyCase(),
      letterCase('Y'), emptyCase(), emptyCase()
    ]
  };
  var pairs = extractWords.extractWordDefPairs(grid);
  assert.deepStrictEqual(pairs, [
    { word: 'AB', definition: 'Across def' },
    { word: 'XY', definition: 'Down def' }
  ]);
});

test('normalizeWord strips accents and uppercases', function () {
  assert.strictEqual(extractWords.normalizeWord('église'), 'EGLISE');
});

test('stripHtml collapses <br/> and whitespace', function () {
  assert.strictEqual(extractWords.stripHtml('Ligne 1<br/>Ligne 2'), 'Ligne 1 Ligne 2');
});
