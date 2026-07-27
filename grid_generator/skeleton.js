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

function meanUsableLength(usableLengthCounts) {
  var lengths = Object.keys(usableLengthCounts).map(Number);
  var total = 0, weightedSum = 0;
  lengths.forEach(function (len) {
    total += usableLengthCounts[len];
    weightedSum += len * usableLengthCounts[len];
  });
  return total > 0 ? weightedSum / total : 0;
}

// stats.descriptionDensity is the real, measured fraction of GSO grid CELLS
// that are descriptions - but generateSkeleton only rolls a probability at
// free-cell DECISIONS, and a decision that starts a run consumes ~L cells
// (the mean usable segment length) versus exactly 1 cell for a description
// decision. Using stats.descriptionDensity directly as the decision
// probability therefore produces a much lower cell-level density than
// intended (empirically ~4-6% instead of the real ~19%, since run-starts
// dilute the count). This inverts that relationship so the resulting
// cell-level density actually converges to the target:
//   p = (d * L) / (d * L + (1 - d))
// Falls back to the raw target density when there's no usable length data
// to compute L from (matches generateSkeleton's existing degenerate-case
// handling for an empty usableLengthCounts).
function computeDecisionDescriptionProbability(stats, usableLengthCounts) {
  var d = stats.descriptionDensity !== undefined ? stats.descriptionDensity : 0.2;
  var L = meanUsableLength(usableLengthCounts);
  if (L <= 0) return d;
  return (d * L) / (d * L + (1 - d));
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
  var decisionDescriptionProbability = computeDecisionDescriptionProbability(stats, usableLengthCounts);

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
      if (rng() < decisionDescriptionProbability) {
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

  repairOrphanDescriptions(types, nbLines, nbColumns);

  return { nbLines: nbLines, nbColumns: nbColumns, types: types };
}

// exportGrid only attaches a definition to a Description cell via a word
// that STARTS immediately to its right (H) or below it (V) - real GSO
// clue placement. At low description density this was rarely an issue, but
// the density-calibration fix (see computeDecisionDescriptionProbability)
// makes Description cells cluster together far more often, regularly
// leaving one with neither neighbor starting a word ("orphan"), which
// exportGrid then can't attach a definition to and validateGrid rejects.
//
// Repair carves a fresh 2-cell run immediately right or below the orphan
// (whichever has room), touching only those 2 cells rather than flipping
// the orphan itself or sweeping whole Description blobs - an earlier,
// blob-eroding version of this repair collapsed density far below target
// (0.3 target measured at 0.19) because flipping every Description that
// merely bordered a Letter cascaded through entire clusters. Carving can
// still occasionally un-start a word that used to begin one cell further
// right/down (its new predecessor is now Letter), so this iterates to a
// fixed point; any orphan with no room for a 2-cell run in either
// direction (grid-corner edge case) is left alone - generate()'s existing
// retry loop discards that skeleton.
function repairOrphanDescriptions(types, nbLines, nbColumns) {
  function isWordStart(idx, axis) {
    if (types[idx] !== enums.CaseType.Letter) return false;
    var col = idx % nbLines;
    var step = axis === 'H' ? 1 : nbLines;
    var atLineStart = axis === 'H' ? col === 0 : idx - nbLines < 0;
    var atLineEnd = axis === 'H' ? col === nbLines - 1 : idx + nbLines >= types.length;
    if (!atLineStart && types[idx - step] === enums.CaseType.Letter) return false;
    if (atLineEnd || types[idx + step] !== enums.CaseType.Letter) return false;
    return true;
  }

  function isOrphan(idx) {
    var col = idx % nbLines;
    var rightAttached = col + 1 < nbLines && isWordStart(idx + 1, 'H');
    var belowAttached = idx + nbLines < types.length && isWordStart(idx + nbLines, 'V');
    return !rightAttached && !belowAttached;
  }

  var changed = true;
  var maxPasses = types.length;
  while (changed && maxPasses-- > 0) {
    changed = false;
    for (var idx = 0; idx < types.length; idx++) {
      if (types[idx] !== enums.CaseType.Description) continue;
      if (!isOrphan(idx)) continue;

      var col = idx % nbLines;
      if (col + 2 < nbLines) {
        types[idx + 1] = enums.CaseType.Letter;
        types[idx + 2] = enums.CaseType.Letter;
        changed = true;
      } else if (idx + 2 * nbLines < types.length) {
        types[idx + nbLines] = enums.CaseType.Letter;
        types[idx + 2 * nbLines] = enums.CaseType.Letter;
        changed = true;
      }
    }
  }
}

module.exports = {
  generateSkeleton: generateSkeleton,
  pickSegmentLength: pickSegmentLength,
  meanUsableLength: meanUsableLength,
  computeDecisionDescriptionProbability: computeDecisionDescriptionProbability
};
