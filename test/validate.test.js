var test = require('node:test');
var assert = require('node:assert');
var enums = require('../game_files/enums');
var validate = require('../grid_generator/validate');

function grid(nbLines, nbColumns, cases) {
  return { nbLines: nbLines, nbColumns: nbColumns, cases: cases };
}
function letterCase() { return { type: enums.CaseType.Letter }; }
function descCase(desc) { return { type: enums.CaseType.Description, desc: desc }; }

test('flags an orphan letter cell (isolated in both axes)', function () {
  var D = descCase(['def']);
  // 3x1: D L L  -- both letters are in a horizontal run of 2, no orphan
  var okGrid = grid(3, 1, [D, letterCase(), letterCase()]);
  assert.strictEqual(validate.validateGrid(okGrid).valid, true);

  // 3x3, cell at index 4 (center) is truly isolated — no letter neighbors in either axis
  var D2 = descCase(['def']);
  var badGrid = grid(3, 3, [
    D2, D2, D2,
    D2, letterCase(), D2,
    D2, D2, D2
  ]);
  var result = validate.validateGrid(badGrid);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(function (e) { return e.indexOf('orpheline') !== -1; }));
});

test('flags a description cell with no definition', function () {
  var badGrid = grid(2, 1, [descCase([]), letterCase()]);
  var result = validate.validateGrid(badGrid);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(function (e) { return e.indexOf('definition') !== -1; }));
});

test('flags a horizontal word starting at column 0 (no cell to its left to hold a description)', function () {
  // 2x2: row0 = L L (a real 2-cell run with nothing before it), row1 = D D
  var badGrid = grid(2, 2, [
    letterCase(), letterCase(),
    descCase(['def']), descCase(['def'])
  ]);
  var result = validate.validateGrid(badGrid);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(function (e) { return e.indexOf('bord de grille') !== -1; }));
});

test('flags a vertical word starting at row 0 (no cell above it to hold a description)', function () {
  // 2x2: col0 top-to-bottom is L L (a real 2-cell run with nothing above it)
  var badGrid = grid(2, 2, [
    letterCase(), descCase(['def']),
    letterCase(), descCase(['def'])
  ]);
  var result = validate.validateGrid(badGrid);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(function (e) { return e.indexOf('bord de grille') !== -1; }));
});

test('does not flag a column-0/row-0 letter cell whose run is properly clued', function () {
  // 3x1: D L L at column 0..2 of a single row - col0 is Description, so the
  // 2-cell letter run starting at col1 is clued from its left, not the edge.
  var D = descCase(['def']);
  var okGrid = grid(3, 1, [D, letterCase(), letterCase()]);
  assert.strictEqual(validate.validateGrid(okGrid).valid, true);
});
