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
