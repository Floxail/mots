function solve(slots, dictionary, options) {
  options = options || {};
  var maxBacktracks = options.maxBacktracks !== undefined ? options.maxBacktracks : 50000;
  var deadlineMs = options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : Infinity;

  var assignment = new Array(slots.length).fill(null);
  var usedWords = new Set();
  var backtrackCount = 0;

  // Domain cache: candidatesFor() is re-derived from scratch for every
  // unassigned slot on every dynamic-MRV scan, which gets expensive as slot
  // count and dictionary size grow (measured: this was the actual bottleneck
  // at 13x15+/50+ slots against a 56k-word dico, not search-space size or
  // dictionary coverage - attempts consistently ran to the full time budget
  // without concluding either way). Cache each slot's current candidate list
  // and only recompute it when something that could change it happens.
  var domainCache = new Array(slots.length).fill(null);
  var allowedWords = options.allowedWords; // optional Array<Set<string>>, indexed by slot index

  // Slot indices grouped by length, so a word becoming used/unused (which
  // affects candidatesFor for every slot of that length, not just crossing
  // neighbors) can invalidate exactly that set instead of everything.
  var slotsByLength = new Map();
  slots.forEach(function (slot, idx) {
    if (!slotsByLength.has(slot.length)) slotsByLength.set(slot.length, []);
    slotsByLength.get(slot.length).push(idx);
  });

  function constraintsFor(slot) {
    var constraints = [];
    slot.crossings.forEach(function (cross) {
      var otherWord = assignment[cross.slotIndex];
      if (otherWord) constraints.push({ pos: cross.ownPos, letter: otherWord[cross.otherPos] });
    });
    return constraints;
  }

  function domainFor(i) {
    if (domainCache[i] === null) {
      var candidates = dictionary.candidatesFor(slots[i].length, constraintsFor(slots[i]), usedWords);
      if (allowedWords) {
        candidates = candidates.filter(function (word) { return allowedWords[i].has(word); });
      }
      domainCache[i] = candidates;
    }
    return domainCache[i];
  }

  // Assigning or unassigning slotIndex changes candidatesFor for: (a) its
  // crossing neighbors (their constraint set changed), (b) every slot
  // sharing its length (usedWords changed), and (c) itself (both reasons
  // can apply to it too). Invalidate all three so the next domainFor() call
  // recomputes instead of reusing a stale list.
  function invalidateAffectedBy(slotIndex) {
    slots[slotIndex].crossings.forEach(function (cross) {
      domainCache[cross.slotIndex] = null;
    });
    slotsByLength.get(slots[slotIndex].length).forEach(function (i) {
      domainCache[i] = null;
    });
  }

  function pickNextSlot() {
    var bestIndex = -1;
    var bestCandidates = null;
    for (var i = 0; i < slots.length; i++) {
      if (assignment[i] !== null) continue;
      var candidates = domainFor(i);
      if (bestCandidates === null ||
        candidates.length < bestCandidates.length ||
        (candidates.length === bestCandidates.length && slots[i].crossings.length > slots[bestIndex].crossings.length)) {
        bestIndex = i;
        bestCandidates = candidates;
      }
      if (bestCandidates.length === 0) break;
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
      invalidateAffectedBy(slotIndex);

      if (backtrack()) return true;

      assignment[slotIndex] = null;
      usedWords.delete(word);
      invalidateAffectedBy(slotIndex);

      backtrackCount++;
      if (backtrackCount > maxBacktracks) return false;
    }
    return false;
  }

  return backtrack() ? assignment : null;
}

module.exports = { solve: solve };
