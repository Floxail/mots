function mulberry32(seed) {
  var state = seed;
  return function () {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    var t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// Min-conflicts local search: unlike backtracking.js's exact (but
// exponential-worst-case) search, this starts every slot filled with SOME
// word, then repeatedly repairs whichever conflicted slot it looks at next -
// no guarantee of finding a solution even if one exists, but empirically far
// more effective on dense CSPs (many simultaneous crossings) than chronological
// backtracking, which can spend its whole budget re-exploring the same dead
// branches. Use as an alternative to solve() when backtracking times out.
function solve(slots, dictionary, options) {
  options = options || {};
  var maxSteps = options.maxSteps !== undefined ? options.maxSteps : 20000;
  // Pure min-conflicts gets permanently stuck on plateaus: measured on a real
  // 56-slot grid, it dropped from 276 to 38 conflict units in the first 5000
  // steps, then sat at exactly 38 for the next 195,000+ steps without moving -
  // every single-slot repair from that state ties or worsens the score, so
  // greedy search alone never escapes it. Restarting from a fresh random fill
  // after a run of steps with no improvement is the standard fix.
  var stagnationLimit = options.stagnationLimit !== undefined ? options.stagnationLimit : 300;
  var deadlineMs = options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : Infinity;
  var rng = options.rng || mulberry32(options.seed !== undefined ? options.seed : Date.now());

  var byLength = new Map();
  slots.forEach(function (slot) {
    if (!byLength.has(slot.length)) byLength.set(slot.length, dictionary.byLength.get(slot.length) || []);
  });

  // Any slot whose length has no candidate words at all can never be filled.
  for (var li = 0; li < slots.length; li++) {
    if ((byLength.get(slots[li].length) || []).length === 0) return null;
  }

  var assignment, usedCount;

  function randomFill() {
    assignment = slots.map(function (slot) {
      return pickRandom(byLength.get(slot.length), rng);
    });
    usedCount = new Map();
    assignment.forEach(function (word) {
      usedCount.set(word, (usedCount.get(word) || 0) + 1);
    });
  }

  function conflictsForValue(slotIndex, word) {
    var count = 0;
    slots[slotIndex].crossings.forEach(function (cross) {
      var neighborWord = assignment[cross.slotIndex];
      if (neighborWord[cross.otherPos] !== word[cross.ownPos]) count++;
    });
    var usedElsewhere = usedCount.get(word) || 0;
    if (assignment[slotIndex] === word) usedElsewhere -= 1; // don't count itself
    if (usedElsewhere > 0) count += usedElsewhere;
    return count;
  }

  function totalConflicts() {
    var total = 0;
    for (var i = 0; i < slots.length; i++) total += conflictsForValue(i, assignment[i]);
    return total;
  }

  function conflictedSlotIndices() {
    var result = [];
    for (var i = 0; i < slots.length; i++) {
      if (conflictsForValue(i, assignment[i]) > 0) result.push(i);
    }
    return result;
  }

  function reassign(slotIndex, newWord) {
    var oldWord = assignment[slotIndex];
    usedCount.set(oldWord, (usedCount.get(oldWord) || 1) - 1);
    assignment[slotIndex] = newWord;
    usedCount.set(newWord, (usedCount.get(newWord) || 0) + 1);
  }

  randomFill();
  var bestTotal = Infinity;
  var stepsSinceImprovement = 0;

  for (var step = 0; step < maxSteps; step++) {
    if (Date.now() > deadlineMs) return null;

    var conflicted = conflictedSlotIndices();
    if (conflicted.length === 0) return assignment.slice();

    var currentTotal = totalConflicts();
    if (currentTotal < bestTotal) {
      bestTotal = currentTotal;
      stepsSinceImprovement = 0;
    } else {
      stepsSinceImprovement++;
    }
    if (stepsSinceImprovement > stagnationLimit) {
      randomFill();
      bestTotal = Infinity;
      stepsSinceImprovement = 0;
      continue;
    }

    var slotIndex = pickRandom(conflicted, rng);
    var pool = byLength.get(slots[slotIndex].length);

    var bestScore = Infinity;
    var bestWords = [];
    for (var c = 0; c < pool.length; c++) {
      var word = pool[c];
      var score = conflictsForValue(slotIndex, word);
      if (score < bestScore) {
        bestScore = score;
        bestWords = [word];
      } else if (score === bestScore) {
        bestWords.push(word);
      }
    }

    reassign(slotIndex, pickRandom(bestWords, rng));
  }

  return null;
}

module.exports = { solve: solve, mulberry32: mulberry32 };
