var test = require('node:test');
var assert = require('node:assert');
var dictionary = require('../grid_generator/dictionary');
var backtracking = require('../grid_generator/backtracking');

test('solve finds a valid assignment, backtracking past a dead-end candidate', function () {
  // DOG is tried first (fails: no length-3 word starts with G for the vertical slot),
  // forcing the solver to backtrack and try CAT instead.
  var dico = dictionary.buildDictionary([
    { word: 'DOG', definitions: ['x'] },
    { word: 'CAT', definitions: ['x'] },
    { word: 'TOY', definitions: ['x'] },
    { word: 'RUN', definitions: ['x'] }
  ]);

  var slots = [
    { axis: 'H', cells: [0, 1, 2], length: 3, crossings: [{ slotIndex: 1, ownPos: 2, otherPos: 0 }] },
    { axis: 'V', cells: [2, 5, 8], length: 3, crossings: [{ slotIndex: 0, ownPos: 0, otherPos: 2 }] }
  ];

  var result = backtracking.solve(slots, dico, {});
  assert.notStrictEqual(result, null);
  assert.strictEqual(result[0][2], result[1][0]); // crossing letter matches
  assert.strictEqual(result[0], 'CAT');
  assert.strictEqual(result[1], 'TOY');
});

test('solve still finds the unique correct assignment through a 3-slot chain with forward checking enabled', function () {
  // A crosses B, B crosses both A and C. Only A='AAM' -> B='MZZ' -> C='ZOO'
  // survives all the way through; every other A choice leads to a B whose
  // gate letter has no matching C word, so forward checking should prune
  // those branches at B (before A/C are even tried) without breaking
  // correctness - the one real solution must still be found.
  var dico = dictionary.buildDictionary([
    { word: 'AAT', definitions: ['x'] }, { word: 'AAG', definitions: ['x'] },
    { word: 'AAS', definitions: ['x'] }, { word: 'AAX', definitions: ['x'] }, { word: 'AAM', definitions: ['x'] },
    { word: 'TBB', definitions: ['x'] }, { word: 'GCC', definitions: ['x'] },
    { word: 'SDD', definitions: ['x'] }, { word: 'XEE', definitions: ['x'] }, { word: 'MZZ', definitions: ['x'] },
    { word: 'ZOO', definitions: ['x'] }
  ]);

  var slots = [
    { axis: 'H', cells: [0, 1, 2], length: 3, crossings: [{ slotIndex: 1, ownPos: 2, otherPos: 0 }] },
    { axis: 'V', cells: [2, 5, 8], length: 3, crossings: [
      { slotIndex: 0, ownPos: 0, otherPos: 2 },
      { slotIndex: 2, ownPos: 2, otherPos: 0 }
    ] },
    { axis: 'H', cells: [6, 7, 8], length: 3, crossings: [{ slotIndex: 1, ownPos: 0, otherPos: 2 }] }
  ];

  var result = backtracking.solve(slots, dico, {});
  assert.deepStrictEqual(result, ['AAM', 'MZZ', 'ZOO']);
});

test('solve rejects reusing a word across two non-crossing slots of the same length (usedWords must not be cached stale)', function () {
  // Two slots that never cross each other at all, both length 3, but the
  // dictionary only has ONE length-3 word. If domain caching only
  // invalidates crossing neighbors (not every same-length slot) when a word
  // gets used, the second slot's cached domain could still show the word as
  // available even after slot 0 consumes it - this must not happen.
  var dico = dictionary.buildDictionary([
    { word: 'CAT', definitions: ['x'] }
  ]);

  var slots = [
    { axis: 'H', cells: [0, 1, 2], length: 3, crossings: [] },
    { axis: 'H', cells: [10, 11, 12], length: 3, crossings: [] }
  ];

  var result = backtracking.solve(slots, dico, {});
  assert.strictEqual(result, null);
});

test('solve returns null when no assignment satisfies the crossing constraint', function () {
  var dico = dictionary.buildDictionary([
    { word: 'DOG', definitions: ['x'] },
    { word: 'RUN', definitions: ['x'] }
  ]);

  var slots = [
    { axis: 'H', cells: [0, 1, 2], length: 3, crossings: [{ slotIndex: 1, ownPos: 2, otherPos: 0 }] },
    { axis: 'V', cells: [2, 5, 8], length: 3, crossings: [{ slotIndex: 0, ownPos: 0, otherPos: 2 }] }
  ];

  var result = backtracking.solve(slots, dico, { maxBacktracks: 10 });
  assert.strictEqual(result, null);
});

test('solve only picks words present in options.allowedWords when it is provided', function () {
  // Without restriction, the solver could pick either DOG or CAT for the
  // single slot (both length 3, no crossings). allowedWords limits it to
  // just CAT.
  var dico = dictionary.buildDictionary([
    { word: 'DOG', definitions: ['x'] },
    { word: 'CAT', definitions: ['x'] }
  ]);
  var slots = [{ axis: 'H', cells: [0, 1, 2], length: 3, crossings: [] }];

  var result = backtracking.solve(slots, dico, { allowedWords: [new Set(['CAT'])] });
  assert.deepStrictEqual(result, ['CAT']);
});

test('solve returns null when allowedWords excludes every candidate for a slot', function () {
  var dico = dictionary.buildDictionary([{ word: 'CAT', definitions: ['x'] }]);
  var slots = [{ axis: 'H', cells: [0, 1, 2], length: 3, crossings: [] }];

  var result = backtracking.solve(slots, dico, { allowedWords: [new Set()] });
  assert.strictEqual(result, null);
});
