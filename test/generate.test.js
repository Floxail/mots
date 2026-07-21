// test/generate.test.js
var test = require('node:test');
var assert = require('node:assert');
var dictionary = require('../grid_generator/dictionary');
var generateGrid = require('../scripts/generate-grid');

test('generate produces a valid grid for a trivial single-slot case', function () {
  // 1 row, 5 wide: Description + a single 4-letter run. Only one segment length
  // is possible, so the skeleton is deterministic regardless of the rng.
  var stats = { segmentLengthCounts: { 4: 1 } };
  var dico = dictionary.buildDictionary([{ word: 'ABCD', definitions: ['test def'] }]);

  var grid = generateGrid.generate(5, 1, dico, stats, { seed: 42 });

  assert.notStrictEqual(grid, null);
  assert.strictEqual(grid.cases[0].type, 3); // Description
  assert.strictEqual(grid.cases[0].desc[0], 'test def');
  assert.strictEqual(grid.cases[1].value, 'A');
  assert.strictEqual(grid.cases[2].value, 'B');
  assert.strictEqual(grid.cases[3].value, 'C');
  assert.strictEqual(grid.cases[4].value, 'D');
});

test('generate returns null when the dictionary cannot satisfy any skeleton', function () {
  var stats = { segmentLengthCounts: { 4: 1 } };
  var dico = dictionary.buildDictionary([{ word: 'ABC', definitions: ['too short'] }]);

  var grid = generateGrid.generate(5, 1, dico, stats, { seed: 42, maxSkeletonAttempts: 2, maxBacktracks: 10 });
  assert.strictEqual(grid, null);
});
