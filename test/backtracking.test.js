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
