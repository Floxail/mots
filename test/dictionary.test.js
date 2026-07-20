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
