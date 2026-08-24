var test = require('node:test');
var assert = require('node:assert');
var maskLib = require('../grid_generator/mask');
var dictionaryLib = require('../grid_generator/dictionary');
var exportLib = require('../grid_generator/export');
var enums = require('../game_files/enums');

function L() { return { kind: 'L' }; }
function D() { return { kind: 'D', arrows: Array.prototype.slice.call(arguments) }; }

test('exportGrid: letters, arrow codes and definitions nearest the target length', function () {
  // 2x2, D(RB,BR) at 0: V slot [1,3] and H slot [2,3]
  var m = { cells: [D('RB', 'BR'), L(), L(), L()], nbLines: 2, nbColumns: 2 };
  var slots = maskLib.deriveSlots(m);
  // AB's options are 27, 6 and 16 characters. The target is 17, so the
  // 16-character one wins - the shortest ("courte") is deliberately NOT the
  // pick any more, and neither is the longest.
  var dico = dictionaryLib.buildDictionary([
    { word: 'AB', definitions: ['une definition assez longue', 'courte', 'juste ce qu il f'] },
    { word: 'CB', definitions: ['def cb'] }
  ]);
  // V slot gets AB (cells 1,3), H slot gets CB (cells 2,3) - shared B at cell 3
  var grid = exportLib.exportGrid(m, slots, ['AB', 'CB'], dico);

  assert.strictEqual(grid.nbLines, 2);
  assert.strictEqual(grid.nbWords, 2);
  assert.strictEqual(grid.cases[0].type, enums.CaseType.Description);
  assert.strictEqual(grid.cases[0].nbDesc, 2);
  assert.deepStrictEqual(grid.cases[0].arrow, [1, 3]); // RB=1, BR=3
  assert.deepStrictEqual(grid.cases[0].desc, ['juste ce qu il f', 'def cb']);
  assert.strictEqual(grid.cases[1].value, 'A');
  assert.strictEqual(grid.cases[2].value, 'C');
  assert.strictEqual(grid.cases[3].value, 'B');
  assert.strictEqual(grid.cases[1].type, enums.CaseType.Letter);
});

test('exportGrid: straight arrows use codes 0 and 2', function () {
  var m = { cells: [D('R', 'B'), L(), L(), L(), L(), L(), L(), L(), L()], nbLines: 3, nbColumns: 3 };
  // R word [1,2], B word [3,6]; remaining letters must be covered for deriveSlots:
  // add defs - simpler: build slots by hand for this test
  var slots = [
    { axis: 'H', cells: [1, 2], length: 2, crossings: [], defCell: 0, arrowIndex: 0 },
    { axis: 'V', cells: [3, 6], length: 2, crossings: [], defCell: 0, arrowIndex: 1 }
  ];
  var dico = dictionaryLib.buildDictionary([
    { word: 'AB', definitions: ['x'] }, { word: 'CD', definitions: ['y'] }
  ]);
  var grid = exportLib.exportGrid(m, slots, ['AB', 'CD'], dico);
  assert.deepStrictEqual(grid.cases[0].arrow, [0, 2]);
});
