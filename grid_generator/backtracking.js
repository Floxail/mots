function solve(slots, dictionary, options) {
  options = options || {};
  var maxBacktracks = options.maxBacktracks !== undefined ? options.maxBacktracks : 50000;
  var deadlineMs = options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : Infinity;

  var assignment = new Array(slots.length).fill(null);
  var usedWords = new Set();
  var backtrackCount = 0;

  function constraintsFor(slot) {
    var constraints = [];
    slot.crossings.forEach(function (cross) {
      var otherWord = assignment[cross.slotIndex];
      if (otherWord) constraints.push({ pos: cross.ownPos, letter: otherWord[cross.otherPos] });
    });
    return constraints;
  }

  // Dynamic MRV: among slots still unassigned, pick the one with the fewest
  // candidates *right now* (not a fixed order computed once up front). This
  // also doubles as forward checking - if placing the previous word left any
  // unassigned slot with zero candidates, that slot has the smallest
  // possible domain size (0) and gets picked immediately, so the dead end is
  // caught on the very next step instead of only once the search eventually
  // reaches that slot in a static order.
  function pickNextSlot() {
    var bestIndex = -1;
    var bestCandidates = null;
    for (var i = 0; i < slots.length; i++) {
      if (assignment[i] !== null) continue;
      var candidates = dictionary.candidatesFor(slots[i].length, constraintsFor(slots[i]), usedWords);
      if (bestCandidates === null ||
        candidates.length < bestCandidates.length ||
        (candidates.length === bestCandidates.length && slots[i].crossings.length > slots[bestIndex].crossings.length)) {
        bestIndex = i;
        bestCandidates = candidates;
      }
      if (bestCandidates.length === 0) break; // can't get more constrained than zero candidates
    }
    return { index: bestIndex, candidates: bestCandidates };
  }

  function backtrack() {
    if (Date.now() > deadlineMs) return false;

    var next = pickNextSlot();
    if (next.index === -1) return true; // every slot assigned
    if (next.candidates.length === 0) return false;

    var slotIndex = next.index;
    for (var c = 0; c < next.candidates.length; c++) {
      var word = next.candidates[c];
      assignment[slotIndex] = word;
      usedWords.add(word);

      if (backtrack()) return true;

      assignment[slotIndex] = null;
      usedWords.delete(word);

      backtrackCount++;
      if (backtrackCount > maxBacktracks) return false;
    }
    return false;
  }

  return backtrack() ? assignment : null;
}

module.exports = { solve: solve };
