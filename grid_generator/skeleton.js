var enums = require('../game_files/enums');

function pickSegmentLength(lengthCounts, rng) {
  var lengths = Object.keys(lengthCounts).map(Number);
  var total = lengths.reduce(function (sum, l) { return sum + lengthCounts[l]; }, 0);
  var r = rng() * total;

  for (var i = 0; i < lengths.length; i++) {
    r -= lengthCounts[lengths[i]];
    if (r <= 0) return lengths[i];
  }
  return lengths[lengths.length - 1];
}

function generateSkeleton(nbLines, nbColumns, stats, rng) {
  var size = nbLines * nbColumns;
  var types = new Array(size).fill(null);

  // A length-1 run gives a Letter cell no horizontal slot at all, leaving it
  // (and the Description cell that starts it) valid only by lucky vertical
  // alignment between unrelated rows. Excluding length 1 here guarantees
  // every row-run is a real >=2 slot, which is enough to keep every Letter
  // cell and every Description cell out of validate.js's orphan/no-definition
  // checks regardless of what happens in the vertical direction.
  var usableLengthCounts = {};
  Object.keys(stats.segmentLengthCounts).forEach(function (len) {
    if (Number(len) >= 2) usableLengthCounts[len] = stats.segmentLengthCounts[len];
  });

  for (var row = 0; row < nbColumns; row++) {
    var col = 0;
    while (col < nbLines) {
      types[row * nbLines + col] = enums.CaseType.Description;
      col++;

      var maxRun = nbLines - col;
      var runLen = maxRun >= 2 ? Math.min(pickSegmentLength(usableLengthCounts, rng), maxRun) : 0;
      for (var k = 0; k < runLen; k++) {
        types[row * nbLines + col + k] = enums.CaseType.Letter;
      }
      col += runLen;
    }
  }

  return { nbLines: nbLines, nbColumns: nbColumns, types: types };
}

module.exports = { generateSkeleton: generateSkeleton, pickSegmentLength: pickSegmentLength };
