var test = require('node:test');
var assert = require('node:assert');
var dictionary = require('../grid_generator/dictionary');

test('candidatesFor with no constraints returns all words of that length, excluding used ones', function () {
  var dico = dictionary.buildDictionary([
    { word: 'CHAT', definitions: ['Petit felin'] },
    { word: 'CHIC', definitions: ['Elegant'] },
    { word: 'BOIS', definitions: ['Matiere ligneuse'] }
  ]);

  var candidates = dico.candidatesFor(4, [], new Set(['CHIC'])).sort();
  assert.deepStrictEqual(candidates, ['BOIS', 'CHAT']);
});

test('candidatesFor filters by letter constraints at given positions', function () {
  var dico = dictionary.buildDictionary([
    { word: 'CHAT', definitions: ['Petit felin'] },
    { word: 'CHIC', definitions: ['Elegant'] },
    { word: 'BOIS', definitions: ['Matiere ligneuse'] }
  ]);

  var candidates = dico.candidatesFor(4, [{ pos: 0, letter: 'C' }], new Set()).sort();
  assert.deepStrictEqual(candidates, ['CHAT', 'CHIC']);

  var narrowed = dico.candidatesFor(4, [{ pos: 0, letter: 'C' }, { pos: 2, letter: 'A' }], new Set());
  assert.deepStrictEqual(narrowed, ['CHAT']);
});

test('definitionsByWord exposes the definitions for export', function () {
  var dico = dictionary.buildDictionary([
    { word: 'CHAT', definitions: ['Petit felin', 'Animal domestique'] }
  ]);
  assert.deepStrictEqual(dico.definitionsByWord.get('CHAT'), ['Petit felin', 'Animal domestique']);
});

test('buildDictionary sorts each byLength pool by descending frequency when a freqMap is given', function () {
  var freqMap = new Map([['CHAT', 5], ['CHIC', 50], ['BOIS', 1]]);
  var dico = dictionary.buildDictionary([
    { word: 'CHAT', definitions: ['x'] },
    { word: 'CHIC', definitions: ['x'] },
    { word: 'BOIS', definitions: ['x'] }
  ], freqMap);

  assert.deepStrictEqual(dico.byLength.get(4), ['CHIC', 'CHAT', 'BOIS']);
});

test('buildDictionary treats a word missing from freqMap as frequency 0 (sorted last)', function () {
  var freqMap = new Map([['CHIC', 50]]);
  var dico = dictionary.buildDictionary([
    { word: 'CHAT', definitions: ['x'] },
    { word: 'CHIC', definitions: ['x'] }
  ], freqMap);

  assert.deepStrictEqual(dico.byLength.get(4), ['CHIC', 'CHAT']);
});

test('buildDictionary without a freqMap keeps dico.json insertion order (no regression)', function () {
  var dico = dictionary.buildDictionary([
    { word: 'BOIS', definitions: ['x'] },
    { word: 'CHAT', definitions: ['x'] },
    { word: 'CHIC', definitions: ['x'] }
  ]);

  assert.deepStrictEqual(dico.byLength.get(4), ['BOIS', 'CHAT', 'CHIC']);
});
