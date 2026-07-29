var test = require('node:test');
var assert = require('node:assert');
var dictionary = require('../grid_generator/dictionary');
var constraintPropagation = require('../grid_generator/constraintPropagation');

test('pruneDomains removes a candidate whose crossing letter has no match in the neighbor domain', function () {
  // H: cells [0,1,2], length 3, crosses V at position 0 (H and V share cell
  // 0, both starting there). V is length 4, so H and V draw from DIFFERENT
  // dictionary.byLength buckets - necessary for this test to isolate one
  // slot's pruning from the other (same-length slots share one pool, so a
  // word "eliminated" from H could simply still be valid AS a V word,
  // which wouldn't exercise real pruning).
  // Only V candidate is 'COWS' (starts with C) - H's 'DOG' (starts with D)
  // can never match and must be pruned; H's 'CAT' (starts with C) survives.
  var dico = dictionary.buildDictionary([
    { word: 'CAT', definitions: ['x'] },
    { word: 'DOG', definitions: ['x'] },
    { word: 'COWS', definitions: ['x'] }
  ]);
  var slots = [
    { axis: 'H', cells: [0, 1, 2], length: 3, crossings: [{ slotIndex: 1, ownPos: 0, otherPos: 0 }] },
    { axis: 'V', cells: [0, 3, 6, 9], length: 4, crossings: [{ slotIndex: 0, ownPos: 0, otherPos: 0 }] }
  ];

  var domains = constraintPropagation.pruneDomains(slots, dico);
  assert.notStrictEqual(domains, null);
  assert.deepStrictEqual(Array.from(domains[0]).sort(), ['CAT']);
  assert.deepStrictEqual(Array.from(domains[1]).sort(), ['COWS']);
});

test('pruneDomains returns null when a slot length has no dictionary words at all', function () {
  var dico = dictionary.buildDictionary([{ word: 'CAT', definitions: ['x'] }]);
  var slots = [{ axis: 'H', cells: [0, 1, 2, 3], length: 4, crossings: [] }];

  assert.strictEqual(constraintPropagation.pruneDomains(slots, dico), null);
});

test('pruneDomains returns null when a crossing constraint eliminates every candidate for a slot', function () {
  // H's ownPos=1 must match V's otherPos=0. Every word in this dictionary
  // has 'A' at position 1 (XAX, YAY) but position 0 is always 'X' or 'Y' -
  // so H's middle letter can never match any V word's first letter.
  // Provably unsatisfiable, with no word-scarcity involved (both slots have
  // 2 full candidates each before propagation).
  var dico = dictionary.buildDictionary([
    { word: 'XAX', definitions: ['x'] },
    { word: 'YAY', definitions: ['x'] }
  ]);
  var slots = [
    { axis: 'H', cells: [0, 1, 2], length: 3, crossings: [{ slotIndex: 1, ownPos: 1, otherPos: 0 }] },
    { axis: 'V', cells: [1, 3, 6], length: 3, crossings: [{ slotIndex: 0, ownPos: 0, otherPos: 1 }] }
  ];

  assert.strictEqual(constraintPropagation.pruneDomains(slots, dico), null);
});
