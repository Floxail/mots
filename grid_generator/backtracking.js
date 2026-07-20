function orderSlots(slots) {
  return slots
    .map(function (slot, idx) { return idx; })
    .sort(function (a, b) {
      var slotA = slots[a], slotB = slots[b];
      if (slotB.crossings.length !== slotA.crossings.length) {
        return slotB.crossings.length - slotA.crossings.length;
      }
      return slotB.length - slotA.length;
    });
}

function solve(slots, dictionary, options) {
  options = options || {};
  var maxBacktracks = options.maxBacktracks !== undefined ? options.maxBacktracks : 50000;
  var deadlineMs = options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : Infinity;

  var order = orderSlots(slots);
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

  function backtrack(orderIdx) {
    if (Date.now() > deadlineMs) return false;
    if (orderIdx >= order.length) return true;

    var slotIndex = order[orderIdx];
    var slot = slots[slotIndex];
    var candidates = dictionary.candidatesFor(slot.length, constraintsFor(slot), usedWords);

    for (var c = 0; c < candidates.length; c++) {
      var word = candidates[c];
      assignment[slotIndex] = word;
      usedWords.add(word);

      if (backtrack(orderIdx + 1)) return true;

      assignment[slotIndex] = null;
      usedWords.delete(word);

      backtrackCount++;
      if (backtrackCount > maxBacktracks) return false;
    }
    return false;
  }

  return backtrack(0) ? assignment : null;
}

module.exports = { solve: solve };
