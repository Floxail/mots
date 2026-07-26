var test = require('node:test');
var assert = require('node:assert');
var enums = require('../game_files/enums');
var dictionary = require('../grid_generator/dictionary');
var exporter = require('../grid_generator/exporter');

test('exportGrid fills letters and attaches definitions/arrows on description cells', function () {
  var D = enums.CaseType.Description, L = enums.CaseType.Letter;
  // 3 wide x 3 tall:
  // row0: D L L   (horizontal word starting at col1)
  // row1: L .  .  (vertical word starting at col0, row1)
  // row2: L .  .
  var skeleton = { nbLines: 3, nbColumns: 3, types: [D, L, L, L, D, D, L, D, D] };
  var slots = [
    { axis: 'H', cells: [1, 2], length: 2, crossings: [] },
    { axis: 'V', cells: [3, 6], length: 2, crossings: [] }
  ];
  var assignment = ['AB', 'XY'];
  var dico = dictionary.buildDictionary([
    { word: 'AB', definitions: ['Across def'] },
    { word: 'XY', definitions: ['Down def'] }
  ]);

  var grid = exporter.exportGrid(skeleton, slots, assignment, dico);

  assert.strictEqual(grid.nbLines, 3);
  assert.strictEqual(grid.nbColumns, 3);
  assert.strictEqual(grid.cases[1].value, 'A');
  assert.strictEqual(grid.cases[2].value, 'B');
  assert.strictEqual(grid.cases[3].value, 'X');
  assert.strictEqual(grid.cases[6].value, 'Y');

  var descCell = grid.cases[0];
  assert.strictEqual(descCell.nbDesc, 2);
  assert.strictEqual(descCell.nbLines, 2);
  assert.deepStrictEqual(descCell.desc, ['Across def', 'Down def']);
  // NOT enums.ArrowDirections - the front-end renderer (grid.js) checks
  // dir===0 for Right and dir===2 for Bottom, matching gridManager.js's own
  // local enumArrow convention, not the shared enum. See exporter.js's
  // ARROW_RIGHT/ARROW_BOTTOM comment for the full explanation.
  assert.deepStrictEqual(descCell.arrow, [0, 2]);
});

test('exportGrid prefers the shortest available definition for a word, not just the first scraped', function () {
  var D = enums.CaseType.Description, L = enums.CaseType.Letter;
  var skeleton = { nbLines: 3, nbColumns: 1, types: [D, L, L] };
  var slots = [{ axis: 'H', cells: [1, 2], length: 2, crossings: [] }];
  var assignment = ['AB'];
  // fsolver-style: several definitions of very different length for the same
  // word, scraped in no particular order. A long one landing first would
  // overflow the 2-line cell layout the client uses when a Description cell
  // has 2 attached definitions - picking the shortest reduces that risk.
  var dico = dictionary.buildDictionary([
    { word: 'AB', definitions: [
      'POUR UN GREFFIER IL NA PAS UNE BIEN BELLE ECRITURE',
      'COURT',
      'UNE DEFINITION DE LONGUEUR MOYENNE ICI'
    ] }
  ]);

  var grid = exporter.exportGrid(skeleton, slots, assignment, dico);
  assert.strictEqual(grid.cases[0].desc[0], 'COURT');
});
