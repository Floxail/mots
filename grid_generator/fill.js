function solve(slots, dictionary, options) {
  options = options || {};
  var maxBacktracks = options.maxBacktracks !== undefined ? options.maxBacktracks : 500000;
  var timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : 30000;
  var deadline = Date.now() + timeoutMs;

  var assignment = new Array(slots.length).fill(null);
  var letters = new Map(); // cellIndex -> letter placed by some assigned slot
  var used = new Set();
  var backtracks = 0;

  function constraintsFor(slot) {
    var constraints = [];
    for (var p = 0; p < slot.cells.length; p++) {
      var letter = letters.get(slot.cells[p]);
      if (letter !== undefined) constraints.push({ pos: p, letter: letter });
    }
    return constraints;
  }

  function search(remaining) {
    if (remaining === 0) return true;
    if (backtracks > maxBacktracks || Date.now() > deadline) return false;

    // MRV: expand the unassigned slot with the fewest candidates
    var best = -1, bestCandidates = null;
    for (var s = 0; s < slots.length; s++) {
      if (assignment[s] !== null) continue;
      var candidates = dictionary.candidatesFor(slots[s].length, constraintsFor(slots[s]), used);
      if (bestCandidates === null || candidates.length < bestCandidates.length) {
        best = s;
        bestCandidates = candidates;
        if (candidates.length === 0) break;
      }
    }
    if (bestCandidates.length === 0) return false;

    var slot = slots[best];
    for (var i = 0; i < bestCandidates.length; i++) {
      var word = bestCandidates[i];
      var placed = [];
      for (var p = 0; p < slot.cells.length; p++) {
        if (!letters.has(slot.cells[p])) { letters.set(slot.cells[p], word[p]); placed.push(slot.cells[p]); }
      }
      assignment[best] = word;
      used.add(word);

      // forward checking: every unassigned crossing slot must keep >= 1 candidate
      var ok = true;
      for (var c = 0; c < slot.crossings.length; c++) {
        var crossIdx = slot.crossings[c].slotIndex;
        if (assignment[crossIdx] !== null) continue;
        if (dictionary.candidatesFor(slots[crossIdx].length, constraintsFor(slots[crossIdx]), used).length === 0) {
          ok = false;
          break;
        }
      }

      if (ok && search(remaining - 1)) return true;

      placed.forEach(function (cell) { letters.delete(cell); });
      assignment[best] = null;
      used.delete(word);
      backtracks++;
      if (backtracks > maxBacktracks || Date.now() > deadline) return false;
    }
    return false;
  }

  var found = search(slots.length);
  if (options.stats) options.stats.backtracks = backtracks;
  return found ? assignment : null;
}

module.exports = { solve: solve };
