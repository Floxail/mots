var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var GridManager = require('../game_files/gridManager');
var Case = require('../game_files/case');
var enums = require('../game_files/enums');

test('loadLocalGrid reads a generate-grid.js-shaped JSON file into the same state as retreiveAndParseGrid', function (t, done) {
  var fixture = {
    nbLines: 3,
    nbColumns: 1,
    nbWords: 1,
    cases: [
      { type: enums.CaseType.Description, desc: ['test def'], arrow: [0], nbDesc: 1 },
      { type: enums.CaseType.Letter, value: 'A', available: true },
      { type: enums.CaseType.Letter, value: 'B', available: true }
    ]
  };
  var tmpFile = path.join(os.tmpdir(), 'gridManager-test-' + Date.now() + '.json');
  fs.writeFileSync(tmpFile, JSON.stringify(fixture));

  var gm = new GridManager();
  gm.loadLocalGrid(tmpFile, function (grid) {
    assert.strictEqual(grid.nbWords, 1);
    assert.strictEqual(grid.cases.length, 3);
    assert.strictEqual(gm.getGridInfos().provider, 'LOCAL');
    assert.strictEqual(gm.getNbRemainingWords(), 1);

    var points = gm.checkPlayerWord({ word: 'AB', axis: 0, start: 1 });
    assert.strictEqual(points, 2);

    fs.unlinkSync(tmpFile);
    done();
  });
});

test('loadLocalGrid reports an error for a missing file instead of throwing', function (t, done) {
  var gm = new GridManager();
  gm.loadLocalGrid(path.join(os.tmpdir(), 'does-not-exist-' + Date.now() + '.json'), function (grid) {
    assert.strictEqual(grid, null);
    done();
  });
});

test('placeArrows maps every GSO description character to the arrows real grids use', function () {
  // Derived empirically over ~50 real GSO grids by constraint propagation: for
  // each definition cell, the only arrow assignment under which every maximal
  // letter run is clued exactly once. Arrow codes are gridManager's local
  // enumArrow (0=Right, 1=RightBottom, 2=Bottom, 3=BottomRight), which is what
  // the client renderer reads - not enums.ArrowDirections.
  var expected = {
    a: [0], b: [2], c: [1], d: [3],
    e: [0, 2], f: [0, 2], g: [0, 2], h: [0, 2], i: [0, 2],
    j: [1, 2], k: [1, 2], l: [1, 2], m: [1, 2], n: [1, 2],
    o: [0, 3], p: [0, 3], q: [0, 3], r: [0, 3], s: [0, 3],
    t: [1, 3], u: [1, 3], v: [1, 3], w: [1, 3], x: [1, 3]
  };

  Object.keys(expected).forEach(function (char) {
    var grid = { nbLines: 1, nbColumns: 1, cases: [new Case.DescriptionCase(0, char)] };
    GridManager.placeArrows(grid);
    assert.deepStrictEqual(grid.cases[0].arrow, expected[char], 'arrows for description char ' + char);
  });
});

test('placeArrows falls back to context inference for an unknown character', function () {
  // 2 wide, 1 tall: unknown char at 0 with a letter to its right -> infers Right.
  var grid = {
    nbLines: 2,
    nbColumns: 1,
    cases: [new Case.DescriptionCase(0, '?'), { type: enums.CaseType.Letter, value: 'A' }]
  };
  GridManager.placeArrows(grid);
  assert.deepStrictEqual(grid.cases[0].arrow, [0]);
});

test('parseGridArg maps the !grid argument to what resetGrid expects', function () {
  var parse = require('../game_files/motsFleches').parseGridArg;

  assert.strictEqual(parse('local'), 'local');          // latest generated grid
  assert.strictEqual(parse('local 12'), 'local:12');    // archived local grid
  assert.strictEqual(parse('local   7'), 'local:7');    // extra spacing tolerated
  assert.strictEqual(parse('2118'), 2118);              // a GSO grid
  assert.strictEqual(parse(''), 0);                     // GSO grid of the day
  assert.strictEqual(parse('n import quoi'), 0);

  // "local12" is not a local grid reference - without the space it would
  // otherwise be read as GSO grid 0 or, worse, local grid 12.
  assert.strictEqual(parse('local12'), 0);
  // A negative or non-integer suffix must not become a local reference either.
  assert.strictEqual(parse('local -3'), 0);
});

test('listLocalGrids returns archived grid numbers in order, ignoring anything else', function () {
  var dir = path.join(os.tmpdir(), 'mfl-grids-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  ['10.json', '2.json', '1.json', 'notes.txt', 'draft.json', '3.json.bak'].forEach(function (name) {
    fs.writeFileSync(path.join(dir, name), '{}');
  });

  // Numeric order, not the lexicographic order readdir would give (10 before 2).
  assert.deepStrictEqual(GridManager.listLocalGrids(dir), [1, 2, 10]);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('listLocalGrids reports an empty archive rather than throwing', function () {
  assert.deepStrictEqual(GridManager.listLocalGrids(path.join(os.tmpdir(), 'mfl-absent-' + Date.now())), []);
});
