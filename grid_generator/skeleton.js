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

  for (var row = 0; row < nbColumns; row++) {
    var col = 0;
    while (col < nbLines) {
      types[row * nbLines + col] = enums.CaseType.Description;
      col++;

      var maxRun = nbLines - col;
      var runLen = maxRun > 0 ? Math.min(pickSegmentLength(stats.segmentLengthCounts, rng), maxRun) : 0;
      for (var k = 0; k < runLen; k++) {
        types[row * nbLines + col + k] = enums.CaseType.Letter;
      }
      col += runLen;
    }
  }

  return { nbLines: nbLines, nbColumns: nbColumns, types: types };
}

module.exports = { generateSkeleton: generateSkeleton, pickSegmentLength: pickSegmentLength };
