var test = require('node:test');
var assert = require('node:assert');
var enums = require('../game_files/enums');
var skeleton = require('../grid_generator/skeleton');

function fixedRng(values) {
  var i = 0;
  return function () {
    var v = values[i % values.length];
    i++;
    return v;
  };
}

test('pickSegmentLength returns a length present in the distribution', function () {
  var counts = { 2: 1, 3: 1 };
  var rng = fixedRng([0.0]);
  assert.strictEqual(skeleton.pickSegmentLength(counts, rng), 2);

  var rng2 = fixedRng([0.9]);
  assert.strictEqual(skeleton.pickSegmentLength(counts, rng2), 3);
});

test('generateSkeleton fills every cell with Description or Letter only', function () {
  var stats = { segmentLengthCounts: { 2: 1, 3: 1 } };
  var rng = fixedRng([0.1, 0.9, 0.3, 0.7]);
  var result = skeleton.generateSkeleton(6, 1, stats, rng);

  assert.strictEqual(result.types.length, 6);
  result.types.forEach(function (t) {
    assert.ok(t === enums.CaseType.Description || t === enums.CaseType.Letter);
  });
  assert.strictEqual(result.types[0], enums.CaseType.Description);
  assert.deepStrictEqual(result.types, [
    enums.CaseType.Description, enums.CaseType.Letter, enums.CaseType.Letter,
    enums.CaseType.Description, enums.CaseType.Letter, enums.CaseType.Letter
  ]);
});

function countRuns(types, nbLines, nbColumns) {
  var runs = [];
  for (var row = 0; row < nbColumns; row++) {
    var runLen = 0;
    for (var col = 0; col < nbLines; col++) {
      if (types[row * nbLines + col] === enums.CaseType.Letter) {
        runLen++;
      } else {
        if (runLen > 0) runs.push(runLen);
        runLen = 0;
      }
    }
    if (runLen > 0) runs.push(runLen);
  }
  return runs;
}

test('generateSkeleton never produces a length-1 horizontal run even when length 1 dominates the distribution', function () {
  var stats = { segmentLengthCounts: { 1: 1000, 2: 1, 3: 1 } };
  var rng = (function () {
    var i = 0;
    var vals = [0.001, 0.5, 0.999, 0.2, 0.7, 0.001, 0.999, 0.5];
    return function () { return vals[(i++) % vals.length]; };
  })();
  var result = skeleton.generateSkeleton(9, 3, stats, rng);
  var runs = countRuns(result.types, 9, 3);
  runs.forEach(function (len) {
    assert.ok(len >= 2, 'expected every horizontal run to be >= 2, got ' + len);
  });
});

test('generateSkeleton does not create a length-1 run when only 1 cell remains at the end of a row', function () {
  var stats = { segmentLengthCounts: { 2: 1 } };
  var rng = fixedRng([0.5]);
  // 5-wide row: D + run(2) => col 3, D at col3 => col4, maxRun=1 (only 1 cell left)
  var result = skeleton.generateSkeleton(5, 1, stats, rng);
  var runs = countRuns(result.types, 5, 1);
  runs.forEach(function (len) {
    assert.ok(len >= 2, 'expected every horizontal run to be >= 2, got ' + len);
  });
});

test('generateSkeleton absorbs a 1-cell stranded stub into the preceding run instead of creating a dead Description cell', function () {
  var stats = { segmentLengthCounts: { 2: 1 } };
  var rng = fixedRng([0.5]);
  // 5-wide row: D@0, run(2)@1-2, then placing a fresh D@3 would strand
  // exactly 1 cell (col4) with no room for a real run. Since col2 (right
  // before col3) is already a Letter, col3 and col4 both get absorbed into
  // that run instead of col3 becoming a Description with zero horizontal
  // reach (which, without a lucky vertical neighbor, fails validate.js's
  // "no definition" check - reproduced against real data before this fix).
  var result = skeleton.generateSkeleton(5, 1, stats, rng);
  assert.deepStrictEqual(result.types, [
    enums.CaseType.Description, enums.CaseType.Letter, enums.CaseType.Letter,
    enums.CaseType.Letter, enums.CaseType.Letter
  ]);
});
