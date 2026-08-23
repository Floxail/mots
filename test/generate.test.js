// test/generate.test.js
var test = require('node:test');
var assert = require('node:assert');
var dictionary = require('../grid_generator/dictionary');
var generateGrid = require('../scripts/generate-grid');

test('generate returns null when the mask pool never fills (maxStale too low to converge)', function () {
  // maxStale 500 is far below what 9x9 needs to converge (default 60000), so
  // the pool stays empty and generate returns null without ever reaching the
  // fill loop - this covers the "no masks to try" path, not a fill failure.
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
  var grid = generateGrid.generate(7, 7, dico, {
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
  // the ABC-only dictionary cannot fill any of these multi-slot 7x7 masks,
  // so every pooled mask is tried and fails - generate must return null.
  assert.strictEqual(grid, null);
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

test('generate returns null when a real pool fills but every fill attempt fails', function () {
  // Same 7x7/maxStale 6000/maskPoolSize 4 shape as the ordering test above:
  // it genuinely builds a pool (unlike a 9x9/low-maxStale combo, which never
  // converges and returns null before the fill loop runs at all - see
  // "generate returns null when the mask pool never fills" above). The
  // ABC-only dictionary can't satisfy any of these masks' crossings, so this
  // exercises "pool had masks, every fill failed, returns null" for real -
  // proven by the onSelect counter below, not assumed.
  var dico = dictionary.buildDictionary([{ word: 'ABC', definitions: ['x'] }]);
  var attempts = 0;
  var grid = generateGrid.generate(7, 7, dico, {
    seed: 3, maxMaskAttempts: 30, maskPoolSize: 4, maxStale: 6000,
    maxBacktracks: 50, timeoutMs: 1500,
    onSelect: function () { attempts++; }
  });
  assert.ok(attempts >= 2, 'fill loop must actually run more than once, got ' + attempts);
  assert.strictEqual(grid, null);
});
