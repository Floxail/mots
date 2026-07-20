var test = require('node:test');
var assert = require('node:assert');
var enums = require('../game_files/enums');
var stats = require('../grid_generator/stats');

function letterCase() { return { type: enums.CaseType.Letter }; }
function descCase(nbDesc) { return { type: enums.CaseType.Description, nbDesc: nbDesc }; }

test('measureSegments finds horizontal letter runs of length >= 1, split by non-letter cells', function () {
  var grid = {
    nbLines: 4,
    nbColumns: 1,
    cases: [descCase(1), letterCase(), letterCase(), letterCase()]
  };
  assert.deepStrictEqual(stats.measureSegments(grid, 'H'), [3]);
});

test('computeStats aggregates density, two-def ratio and segment lengths across grids', function () {
  var gridA = {
    nbLines: 4,
    nbColumns: 1,
    cases: [descCase(1), letterCase(), letterCase(), letterCase()]
  };
  var gridB = {
    nbLines: 4,
    nbColumns: 1,
    cases: [descCase(2), letterCase(), letterCase(), letterCase()]
  };

  var result = stats.computeStats([gridA, gridB]);

  assert.strictEqual(result.descriptionDensity, 2 / 8);
  assert.strictEqual(result.twoDefRatio, 1 / 2);
  assert.ok(result.segmentLengthCounts[3] >= 2);
});
