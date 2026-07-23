var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var GridManager = require('../game_files/gridManager');
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
