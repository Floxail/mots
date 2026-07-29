// AC-3 over the crossing-slot graph: a "variable" is a slot, its "domain"
// is the set of dictionary words that could still fill it, and an "arc"
// A->B means "every surviving word in A's domain must have, at its
// crossing position, a letter that some surviving word in B's domain also
// has at ITS crossing position". Pruning this BEFORE handing slots to
// backtracking.js catches an unsatisfiable skeleton immediately (empty
// domain) instead of letting the solver spend its whole time budget
// discovering the same dead end by exhaustive search.
function pruneDomains(slots, dictionary) {
  var domains = slots.map(function (slot) {
    return new Set(dictionary.byLength.get(slot.length) || []);
  });

  for (var i = 0; i < domains.length; i++) {
    if (domains[i].size === 0) return null;
  }

  function lettersAt(domain, pos) {
    var letters = new Set();
    domain.forEach(function (word) { letters.add(word[pos]); });
    return letters;
  }

  // Revise domains[a] against domains[b]: a word survives only if its
  // letter at ownPos is one some word in domains[b] has at otherPos.
  // Returns true if domains[a] actually shrank (caller must re-propagate).
  function revise(a, ownPos, b, otherPos) {
    var allowedLetters = lettersAt(domains[b], otherPos);
    var before = domains[a].size;
    var next = new Set();
    domains[a].forEach(function (word) {
      if (allowedLetters.has(word[ownPos])) next.add(word);
    });
    domains[a] = next;
    return next.size !== before;
  }

  // Every directed arc, one per crossing entry - slots.js already records
  // both directions (slot A lists its crossing into B, and slot B
  // separately lists its own crossing back into A).
  var queue = [];
  slots.forEach(function (slot, a) {
    slot.crossings.forEach(function (cross) {
      queue.push([a, cross.ownPos, cross.slotIndex, cross.otherPos]);
    });
  });

  while (queue.length > 0) {
    var arc = queue.shift();
    var a = arc[0], ownPos = arc[1], b = arc[2], otherPos = arc[3];

    if (!revise(a, ownPos, b, otherPos)) continue;
    if (domains[a].size === 0) return null;

    // domains[a] changed - re-check every neighbor of a (except b, the one
    // we just revised against) since a's shrunken domain might now
    // eliminate more of THEIR candidates too.
    slots[a].crossings.forEach(function (cross) {
      if (cross.slotIndex === b) return;
      queue.push([cross.slotIndex, cross.otherPos, a, cross.ownPos]);
    });
  }

  return domains;
}

module.exports = { pruneDomains: pruneDomains };
