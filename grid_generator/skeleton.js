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

// The 2D sweep only, with no orphan repair - split out so tests targeting
// the sweep's own row/column-obligation bookkeeping aren't coupled to
// repairOrphanDescriptions' separate, unrelated concern (see generateSkeleton).
function sweepSkeleton(nbLines, nbColumns, stats, rng) {
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

      // A free cell (no active obligation of its own) whose left or top
      // neighbor is already Letter would, if it also became Letter, merge
      // into that neighbor's run purely by adjacency - deriveSlots doesn't
      // know or care *why* a cell is Letter. If that neighbor's run has no
      // valid Description behind it (the col-0/row-0 guards above stop the
      // neighbor being a *fresh* edge start, but not a forced vertical/
      // horizontal continuation that happens to land there), the merged
      // run inherits that lack of a clue. Forcing Description here is
      // always safe - it never breaks an existing run, only declines to
      // silently extend one - and it also hands the *next* cell a valid
      // clue-provider instead of another Letter to merge into.
      if ((col > 0 && types[idx - 1] === enums.CaseType.Letter) ||
          (idx - nbLines >= 0 && types[idx - nbLines] === enums.CaseType.Letter)) {
        types[idx] = enums.CaseType.Description;
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
        // Column 0 has no cell to its left to hold the Description that would
        // clue this word - exportGrid can never attach a definition to it.
        if (col === 0) return false;
        if (horizontalRoom < 2) return false;
        var length = Math.min(pickSegmentLength(usableLengthCounts, rng), horizontalRoom);
        if (length < 2) return false;
        types[idx] = enums.CaseType.Letter;
        rowRemaining = length - 1;
        return true;
      }

      function tryStartVertical() {
        // Row 0 has no cell above it to hold the Description that would clue
        // this word - same reasoning as the column-0 case above.
        if (row === 0) return false;
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

function generateSkeleton(nbLines, nbColumns, stats, rng) {
  var skeleton = sweepSkeleton(nbLines, nbColumns, stats, rng);
  repairOrphanDescriptions(skeleton.types, nbLines, nbColumns);
  return skeleton;
}

// exportGrid only attaches a definition to a Description cell via a word
// that STARTS immediately to its right (H) or below it (V) - real GSO
// clue placement. At low description density this was rarely an issue, but
// the density-calibration fix (see computeDecisionDescriptionProbability)
// makes Description cells cluster together far more often, regularly
// leaving one with neither neighbor starting a word ("orphan"), which
// exportGrid then can't attach a definition to and validateGrid rejects.
//
// Two repair strategies, cheapest first:
//  1. If the orphan borders an existing Letter cell, flip the orphan itself
//     to Letter - it just extends that run by one cell (same slot, one
//     longer), adding no new constraint for backtracking.solve() to satisfy.
//  2. Only when fully boxed in by Descriptions (no Letter neighbor at all)
//     carve a brand-new 2-cell run right or below. This creates an
//     independent slot the solver must satisfy from scratch, which at 15x15
//     real-density scale (dozens of orphans/grid) was expensive enough to
//     make backtracking.solve() fail on nearly every attempt when it was
//     the *only* strategy - so it's now the fallback, not the default.
// Flipping the orphan itself does cost some density (an earlier version
// that used ONLY that strategy measured 0.3 target -> 0.19 observed on a
// high-density synthetic stress test, from cascading through whole
// Description blobs) - hence trying it only where it's this cheap, and
// falling back to carving otherwise. Iterates to a fixed point since a
// flip can satisfy a neighboring orphan's check too; any orphan neither
// strategy can resolve (grid-corner edge case) is left alone - generate()'s
// existing retry loop discards that skeleton.
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

  function hasLetterNeighbor(idx) {
    var col = idx % nbLines;
    if (col > 0 && types[idx - 1] === enums.CaseType.Letter) return true;
    if (col + 1 < nbLines && types[idx + 1] === enums.CaseType.Letter) return true;
    if (idx - nbLines >= 0 && types[idx - nbLines] === enums.CaseType.Letter) return true;
    if (idx + nbLines < types.length && types[idx + nbLines] === enums.CaseType.Letter) return true;
    return false;
  }

  // Turning cellIdx into Letter can merge it into a neighboring run purely
  // by adjacency, same as the sweep's own adjacency guard above - this
  // applies both to flipping the orphan itself and to the cells the carve
  // fallback below creates. If that merge's column-0 or row-0 cell ends up
  // Letter with a Letter right next to / below it, the run has no cell left
  // to hold a description - not just when cellIdx itself sits on the edge
  // (an *interior* cell can just as easily bridge an edge-adjacent Letter
  // into a longer unclueable run). Uses the current types array, so call it
  // before committing the Letter assignment it's checking.
  function wouldCreateEdgeStart(cellIdx) {
    var row = Math.floor(cellIdx / nbLines);
    var col = cellIdx % nbLines;

    // Find the full extent of the horizontal run cellIdx would join
    // (counting cellIdx itself as Letter): how far it reaches left and right.
    var left = col;
    while (left > 0 && types[row * nbLines + left - 1] === enums.CaseType.Letter) left--;
    var right = col;
    while (right < nbLines - 1 && types[row * nbLines + right + 1] === enums.CaseType.Letter) right++;
    var hBad = left === 0 && right > left;

    // Same for the vertical run: how far it reaches up and down.
    var top = row;
    while (top > 0 && types[(top - 1) * nbLines + col] === enums.CaseType.Letter) top--;
    var bottom = row;
    while (bottom < nbColumns - 1 && types[(bottom + 1) * nbLines + col] === enums.CaseType.Letter) bottom++;
    var vBad = top === 0 && bottom > top;

    return hBad || vBad;
  }

  var changed = true;
  var maxPasses = types.length;
  while (changed && maxPasses-- > 0) {
    changed = false;
    for (var idx = 0; idx < types.length; idx++) {
      if (types[idx] !== enums.CaseType.Description) continue;
      if (!isOrphan(idx)) continue;

      if (hasLetterNeighbor(idx) && !wouldCreateEdgeStart(idx)) {
        types[idx] = enums.CaseType.Letter;
        changed = true;
        continue;
      }

      // Carving right keeps idx itself as Description, so the new run's
      // *horizontal* start is always safely clued - but the two new Letter
      // cells can still each bridge into an existing run reaching row 0
      // vertically, so they need the same check before committing. Same
      // reasoning for carving down, mirrored onto the horizontal axis.
      var col = idx % nbLines;
      if (col + 2 < nbLines &&
          !wouldCreateEdgeStart(idx + 1) && !wouldCreateEdgeStart(idx + 2)) {
        types[idx + 1] = enums.CaseType.Letter;
        types[idx + 2] = enums.CaseType.Letter;
        changed = true;
      } else if (idx + 2 * nbLines < types.length &&
          !wouldCreateEdgeStart(idx + nbLines) && !wouldCreateEdgeStart(idx + 2 * nbLines)) {
        types[idx + nbLines] = enums.CaseType.Letter;
        types[idx + 2 * nbLines] = enums.CaseType.Letter;
        changed = true;
      }
      // Neither strategy is safe here (rare grid-corner case) - left alone,
      // generate()'s retry loop discards a skeleton that still has this.
    }
  }
}

// A word can only be clued by a Description cell immediately to its left
// (H) or above it (V), so a Letter run starting right at column 0 or row 0
// can never be clued - see repairOrphanDescriptions' wouldCreateEdgeStart
// for why the sweep/repair passes can't fully rule this out on their own
// (two independently-valid runs from different rows/columns can still land
// next to each other by coincidence). Cheap enough to call on every
// skeleton attempt before deriving slots or spending any solver budget -
// generate() uses this to skip a doomed skeleton immediately rather than
// only discovering the same thing after a full solve + export.
function hasUnclueableEdgeStart(skeleton) {
  var types = skeleton.types, nbLines = skeleton.nbLines, nbColumns = skeleton.nbColumns;
  for (var row = 0; row < nbColumns; row++) {
    var idx = row * nbLines;
    if (types[idx] === enums.CaseType.Letter && types[idx + 1] === enums.CaseType.Letter) return true;
  }
  for (var col = 0; col < nbLines; col++) {
    if (types[col] === enums.CaseType.Letter && types[nbLines + col] === enums.CaseType.Letter) return true;
  }
  return false;
}

module.exports = {
  hasUnclueableEdgeStart: hasUnclueableEdgeStart,
  generateSkeleton: generateSkeleton,
  sweepSkeleton: sweepSkeleton,
  pickSegmentLength: pickSegmentLength,
  meanUsableLength: meanUsableLength,
  computeDecisionDescriptionProbability: computeDecisionDescriptionProbability
};
