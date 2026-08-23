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
  // seed 1 reaches a deriveSlots-valid mask on the first attempt at the
  // default maxStale (60000) - see test/mask.test.js's convergence canary
  // (Task 10: the clustered k in {2,3} mutation operator plus the raised
  // default maxStale changed which seeds converge; seed 86 - valid under
  // the old k=1 operator - no longer converges within 2 attempts).
  generateGrid.generate(9, 9, dico, {
    seed: 1, maxMaskAttempts: 2, maxBacktracks: 100, timeoutMs: 2000,
    onAttempt: function () { calls++; }
  });
  assert.ok(calls >= 1);
});

test('generate fills the lowest-penalty mask in the pool first', function () {
  // Three stub masks with known penalties, handed to generate via a stubbed
  // mask library is not reachable from here - so this asserts the observable
  // consequence instead: onSelect reports strictly increasing penalties,
  // i.e. the pool really was tried in ascending order.
  // 7x7 / maxStale 6000 converges 4 masks with distinct penalties in under
  // a second (probed by hand) - unlike the 9x9/maxStale:800 combo this
  // replaced, where deriveSlots never converged and onSelect never fired,
  // making the ordering assertion pass vacuously on an empty pool.
  var dico = dictionary.buildDictionary([{ word: 'ABC', definitions: ['x'] }]);
  var seen = [];
  generateGrid.generate(7, 7, dico, {
    seed: 3, maxMaskAttempts: 30, maskPoolSize: 4, maxStale: 6000,
    maxBacktracks: 50, timeoutMs: 1500,
    onSelect: function (poolSize, rank, penalty) { seen.push(penalty); }
  });
  // guard against a silently empty pool - without this the ordering loop
  // below would pass on zero iterations, same failure mode as before
  assert.ok(seen.length >= 2, 'pool must actually fill for this assertion to mean anything, got ' + seen.length);
  // the dictionary cannot fill anything, so every pooled mask is attempted
  for (var i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1],
      'pool must be tried in ascending penalty order, got ' + seen.join(','));
  }
});

test('generate stops collecting masks once the pool is full', function () {
  var dico = dictionary.buildDictionary([{ word: 'ABC', definitions: ['x'] }]);
  var found = 0;
  generateGrid.generate(7, 7, dico, {
    seed: 3, maxMaskAttempts: 30, maskPoolSize: 2, maxStale: 6000,
    maxBacktracks: 50, timeoutMs: 1500,
    onAttempt: function () { found++; }
  });
  // lower bound: the pool must actually have collected something, or the
  // upper bound below is vacuous (0 <= 2 is trivially true)
  assert.ok(found > 0, 'pool must actually collect masks for this assertion to mean anything, got ' + found);
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
