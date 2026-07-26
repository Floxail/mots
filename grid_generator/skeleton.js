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
  // valid only by lucky vertical alignment between unrelated rows. Excluding
  // length 1 here guarantees every row-run is a real >=2 slot, which keeps
  // every Letter cell out of validate.js's orphan check regardless of what
  // happens in the vertical direction.
  var usableLengthCounts = {};
  Object.keys(stats.segmentLengthCounts).forEach(function (len) {
    if (Number(len) >= 2) usableLengthCounts[len] = stats.segmentLengthCounts[len];
  });

  for (var row = 0; row < nbColumns; row++) {
    var col = 0;

    // ~50% of rows open with a letter run instead of a Description, so the
    // grid's left edge isn't a solid column of descriptions (confirmed
    // against a real generated grid: every row started with one, which no
    // real GSO grid does - a row can just as validly open with a vertical
    // word's continuation letters as with a definition).
    if (nbLines >= 4 && rng() < 0.5) {
      var openRun = Math.min(pickSegmentLength(usableLengthCounts, rng), nbLines);
      for (var k0 = 0; k0 < openRun; k0++) types[row * nbLines + k0] = enums.CaseType.Letter;
      col = openRun;
    }

    while (col < nbLines) {
      // Placing a Description here would strand exactly 1 cell after it (no
      // room for a real run) - if the cell just before this one is already
      // part of a letter run, absorb the remainder into that run instead of
      // creating a new Description with zero horizontal reach. Such a cell
      // would depend entirely on vertical luck for a definition, and this
      // codebase's row-only tiling doesn't coordinate columns between rows
      // to make that reliable (confirmed in production: "Case description
      // sans definition" failures traced back to exactly this case).
      var strandedByDescHere = nbLines - col - 1;
      if (strandedByDescHere === 1 && col > 0 && types[row * nbLines + col - 1] === enums.CaseType.Letter) {
        for (var k = col; k < nbLines; k++) types[row * nbLines + k] = enums.CaseType.Letter;
        break;
      }

      types[row * nbLines + col] = enums.CaseType.Description;
      col++;

      var maxRun = nbLines - col;
      var runLen = maxRun >= 2 ? Math.min(pickSegmentLength(usableLengthCounts, rng), maxRun) : 0;
      for (var k2 = 0; k2 < runLen; k2++) {
        types[row * nbLines + col + k2] = enums.CaseType.Letter;
      }
      col += runLen;
    }
  }

  return { nbLines: nbLines, nbColumns: nbColumns, types: types };
}

module.exports = { generateSkeleton: generateSkeleton, pickSegmentLength: pickSegmentLength };
