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

  // A length-1 run gives a Letter cell no same-axis slot at all. Excluding
  // length 1 from the pool guarantees every run this module starts (H or V)
  // is a real >=2 slot.
  var usableLengthCounts = {};
  Object.keys(stats.segmentLengthCounts).forEach(function (len) {
    if (Number(len) >= 2) usableLengthCounts[len] = stats.segmentLengthCounts[len];
  });
  var descriptionDensity = stats.descriptionDensity !== undefined ? stats.descriptionDensity : 0.2;

  // columnObligation[c] tracks an in-progress vertical run started by an
  // earlier row: null (free) or { remaining } (this many more rows in
  // column c must be Letter to complete the run that was already started).
  var columnObligation = new Array(nbLines).fill(null);

  for (var row = 0; row < nbColumns; row++) {
    var rowRemaining = 0;

    for (var col = 0; col < nbLines; col++) {
      var idx = row * nbLines + col;
      var colObligated = columnObligation[col] !== null;
      var rowObligated = rowRemaining > 0;

      if (colObligated || rowObligated) {
        // Forced Letter: continuing an already-started run in one or both
        // axes. Both active at once is a natural crossing, not special-cased.
        types[idx] = enums.CaseType.Letter;
        if (colObligated) {
          columnObligation[col].remaining--;
          if (columnObligation[col].remaining === 0) columnObligation[col] = null;
        }
        if (rowObligated) rowRemaining--;
        continue;
      }

      // Free cell: decide fresh.
      if (rng() < descriptionDensity) {
        types[idx] = enums.CaseType.Description;
        continue;
      }

      var tryHorizontalFirst = rng() < 0.5;
      var horizontalRoom = nbLines - col;
      var verticalRoom = nbColumns - row;

      var started = false;
      if (tryHorizontalFirst) {
        started = tryStartHorizontal();
        if (!started) started = tryStartVertical();
      } else {
        started = tryStartVertical();
        if (!started) started = tryStartHorizontal();
      }
      if (!started) types[idx] = enums.CaseType.Description;

      function tryStartHorizontal() {
        if (horizontalRoom < 2) return false;
        var length = Math.min(pickSegmentLength(usableLengthCounts, rng), horizontalRoom);
        if (length < 2) return false;
        types[idx] = enums.CaseType.Letter;
        rowRemaining = length - 1;
        return true;
      }

      function tryStartVertical() {
        if (verticalRoom < 2) return false;
        var length = Math.min(pickSegmentLength(usableLengthCounts, rng), verticalRoom);
        if (length < 2) return false;
        types[idx] = enums.CaseType.Letter;
        columnObligation[col] = { remaining: length - 1 };
        return true;
      }
    }
  }

  return { nbLines: nbLines, nbColumns: nbColumns, types: types };
}

module.exports = { generateSkeleton: generateSkeleton, pickSegmentLength: pickSegmentLength };
