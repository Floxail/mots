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
  // seed 86 reaches a deriveSlots-valid mask on the first attempt at the
  // default maxStale (5000) - see test/mask.test.js's convergence canary
  // (Task 9: unclued-run gate made deriveSlots much stricter, so seed 1 /
  // maxStale 500 no longer reaches a valid mask within 2 attempts).
  generateGrid.generate(9, 9, dico, {
    seed: 86, maxMaskAttempts: 2, maxBacktracks: 100, timeoutMs: 2000,
    onAttempt: function () { calls++; }
  });
  assert.ok(calls >= 1);
});
