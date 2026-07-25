var test = require('node:test');
var assert = require('node:assert');
var dictionary = require('../grid_generator/dictionary');
var minConflicts = require('../grid_generator/minConflicts');

function fixedRng(values) {
  var i = 0;
  return function () {
    var v = values[i % values.length];
    i++;
    return v;
  };
}

test('solve finds a valid assignment for a simple 2-slot crossing', function () {
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

  var result = minConflicts.solve(slots, dico, { seed: 1 });
  assert.notStrictEqual(result, null);
  assert.strictEqual(result[0][2], result[1][0]); // crossing letter matches
});

test('solve never leaves the same word assigned to two different slots', function () {
  // Only one length-3 word available; two slots need one each - unsatisfiable,
  // but the search must not "solve" it by duplicating the single word.
  var dico = dictionary.buildDictionary([
    { word: 'CAT', definitions: ['x'] }
  ]);

  var slots = [
    { axis: 'H', cells: [0, 1, 2], length: 3, crossings: [] },
    { axis: 'H', cells: [10, 11, 12], length: 3, crossings: [] }
  ];

  var result = minConflicts.solve(slots, dico, { seed: 1, maxSteps: 200 });
  assert.strictEqual(result, null);
});

test('solve finds the unique correct assignment through a 3-slot chain', function () {
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

  var result = minConflicts.solve(slots, dico, { seed: 7 });
  assert.deepStrictEqual(result, ['AAM', 'MZZ', 'ZOO']);
});

test('solve returns null within maxSteps when the dictionary cannot satisfy the crossing', function () {
  var dico = dictionary.buildDictionary([
    { word: 'DOG', definitions: ['x'] },
    { word: 'RUN', definitions: ['x'] }
  ]);

  var slots = [
    { axis: 'H', cells: [0, 1, 2], length: 3, crossings: [{ slotIndex: 1, ownPos: 2, otherPos: 0 }] },
    { axis: 'V', cells: [2, 5, 8], length: 3, crossings: [{ slotIndex: 0, ownPos: 0, otherPos: 2 }] }
  ];

  var result = minConflicts.solve(slots, dico, { seed: 1, maxSteps: 50 });
  assert.strictEqual(result, null);
});
