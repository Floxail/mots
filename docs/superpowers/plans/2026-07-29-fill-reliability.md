# Fill Reliability (AC-3 pruning + frequency ordering) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 13x15/15x15 grid generation succeed reliably at real GSO description density by pruning provably-unsatisfiable skeletons instantly (AC-3-style domain propagation) and trying common words first (real-frequency ordering), instead of relying on plain backtracking to discover dead ends the slow way.

**Architecture:** A new `constraintPropagation.js` module runs AC-3 across the crossing-slot graph right after slots are derived, producing either `null` (skeleton is provably dead, skip it without ever calling the solver) or a per-slot set of surviving candidate words. `backtracking.js` gets a thin optional filter (`options.allowedWords`) to respect that pruning. Separately, `dictionary.js` can now sort its per-length word pools by real usage frequency (parsed from `data/Lexique4.tsv` via a new small `lexiqueFrequency.js` module), so both the pruning step and the solver try plausible words first. `scripts/generate-grid.js` wires both in.

**Tech Stack:** Node.js (`node --test`), no new dependencies - reuses the existing plain-object/Map/Set-based data structures already used across `grid_generator/*.js`.

## Global Constraints

- No new npm dependencies (matches existing `grid_generator/*` modules, which are all dependency-free).
- `var`-based ES5-style function bodies, matching the existing style in every file this plan touches (no arrow functions, no `let`/`const`) - follow the surrounding code's style in every file edited.
- Every new/changed function must keep the existing modules' pattern of a single `module.exports = { ... }` at the end of the file.
- `minConflicts.js` and incremental (during-search) arc-consistency (MAC) are explicitly out of scope - do not touch `grid_generator/minConflicts.js` in this plan.
- Tests use `node --test` / `node:assert` (see any existing `test/*.test.js` for the exact style) - no other test framework.

---

### Task 1: `grid_generator/lexiqueFrequency.js` - parse Lexique4.tsv into a word→frequency map

**Files:**
- Create: `grid_generator/lexiqueFrequency.js`
- Test: `test/lexiqueFrequency.test.js`

**Interfaces:**
- Consumes: `grid_generator/extractWords.js`'s `normalizeWord(raw)` (exported already - strips accents via NFD + regex, uppercases).
- Produces: `buildFrequencyMap(rawText)` → `Map<string, number>` (normalized word → highest frequency seen for that word form). Task 2 consumes this map's shape directly (`freqMap.get(word) || 0`).

This mirrors the parsing already proven in `scripts/scrape-fsolver.js::buildCandidateListFromLexique` (header row skipped, tab-split, column index 9 = `10_FreqMot`), but produces a plain frequency lookup instead of a curated word list - no length filtering, no `alreadyKnown`/`curatedWords` exclusion, no A-Z-only regex (Task 2 only ever looks up words that are already in `data/dico.json`, so over-inclusion here is harmless).

- [ ] **Step 1: Write the failing test**

```js
// test/lexiqueFrequency.test.js
var test = require('node:test');
var assert = require('node:assert');
var lexiqueFrequency = require('../grid_generator/lexiqueFrequency');

var HEADER = '1_Mot\t2_Phono\t3_Phono_IPA\t4_Lemme\t5_Cgram\t6_CgramOrtho\t7_Genre\t8_Nombre\t9_InfoVER\t10_FreqMot\t11_FreqOrtho\t12_FreqLemme\t13_CDOrtho\t14_IsLem\t15_NbLettres';

test('buildFrequencyMap reads word and frequency (column index 9) from each row, skipping the header', function () {
  var rawText = [
    HEADER,
    'chat\tS\tS\tchat\tNOM\tNOM\tm\ts\t\t12.34\t0\t0\t0\t1\t4'
  ].join('\n');

  var freqMap = lexiqueFrequency.buildFrequencyMap(rawText);
  assert.strictEqual(freqMap.get('CHAT'), 12.34);
});

test('buildFrequencyMap normalizes accents and case to match dico.json word format', function () {
  var rawText = [
    HEADER,
    'disproportionnées\tx\tx\tx\tVER\tVER\tf\tp\t\t0.041\t0\t0\t0\t0\t17'
  ].join('\n');

  var freqMap = lexiqueFrequency.buildFrequencyMap(rawText);
  assert.strictEqual(freqMap.get('DISPROPORTIONNEES'), 0.041);
});

test('buildFrequencyMap keeps the highest frequency when the same word form appears on multiple rows', function () {
  var rawText = [
    HEADER,
    'chat\tx\tx\tx\tNOM\tNOM\tm\ts\t\t1\t0\t0\t0\t1\t4',
    'chat\tx\tx\tx\tNOM\tNOM\tm\ts\t\t99\t0\t0\t0\t1\t4',
    'chat\tx\tx\tx\tNOM\tNOM\tm\ts\t\t5\t0\t0\t0\t1\t4'
  ].join('\n');

  var freqMap = lexiqueFrequency.buildFrequencyMap(rawText);
  assert.strictEqual(freqMap.get('CHAT'), 99);
});

test('buildFrequencyMap skips malformed rows (too few columns) instead of throwing', function () {
  var rawText = [
    HEADER,
    'trop\tcourt',
    'chat\tx\tx\tx\tNOM\tNOM\tm\ts\t\t7\t0\t0\t0\t1\t4'
  ].join('\n');

  var freqMap = lexiqueFrequency.buildFrequencyMap(rawText);
  assert.strictEqual(freqMap.size, 1);
  assert.strictEqual(freqMap.get('CHAT'), 7);
});

test('buildFrequencyMap treats an unparseable frequency column as 0', function () {
  var rawText = [
    HEADER,
    'chat\tx\tx\tx\tNOM\tNOM\tm\ts\t\t\t0\t0\t0\t1\t4'
  ].join('\n');

  var freqMap = lexiqueFrequency.buildFrequencyMap(rawText);
  assert.strictEqual(freqMap.get('CHAT'), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/lexiqueFrequency.test.js`
Expected: FAIL with `Cannot find module '../grid_generator/lexiqueFrequency'`

- [ ] **Step 3: Write the implementation**

```js
// grid_generator/lexiqueFrequency.js
var extractWords = require('./extractWords');

// Lexique4.tsv (lexique.org) - real French usage frequency per word form.
// Column index 9 is "10_FreqMot" (frequency per million occurrences), the
// same signal scripts/scrape-fsolver.js::buildCandidateListFromLexique
// already uses to curate data/dico.json's word list. This builds a full
// word -> frequency lookup instead, for sorting a dictionary's candidate
// pools at runtime (grid_generator/dictionary.js's buildDictionary).
function buildFrequencyMap(rawText) {
  var freqMap = new Map();
  var lines = rawText.split('\n');

  for (var i = 1; i < lines.length; i++) {
    var cols = lines[i].split('\t');
    if (cols.length < 15) continue;

    var word = extractWords.normalizeWord(cols[0]);
    var freq = parseFloat(cols[9]) || 0;
    if (freqMap.has(word) && freqMap.get(word) >= freq) continue;
    freqMap.set(word, freq);
  }

  return freqMap;
}

module.exports = { buildFrequencyMap: buildFrequencyMap };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/lexiqueFrequency.test.js`
Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add grid_generator/lexiqueFrequency.js test/lexiqueFrequency.test.js
git commit -m "$(cat <<'EOF'
feat: add Lexique4.tsv frequency map parser

Reuses the frequency-parsing logic already proven in
scrape-fsolver.js::buildCandidateListFromLexique, but as a general
word->frequency lookup rather than a curated word-list builder. Feeds
dictionary.js's upcoming frequency-based candidate ordering.
EOF
)"
```

---

### Task 2: `grid_generator/dictionary.js` - optional frequency-sorted candidate pools

**Files:**
- Modify: `grid_generator/dictionary.js:1` (function signature) and after the `entries.forEach` block (currently ends around line 27, right before `function candidatesFor`)
- Test: `test/dictionary.test.js` (add to existing file)

**Interfaces:**
- Consumes: `Map<string, number>` shaped exactly like Task 1's `buildFrequencyMap()` output (but the function must not import `lexiqueFrequency.js` - it accepts any `Map`, keeping the module decoupled and testable with a plain hand-built `Map`).
- Produces: `buildDictionary(entries, freqMap)` - `freqMap` is optional (existing call sites with one argument keep working). Returned object shape is unchanged (`{ byLength, crossIndex, definitionsByWord, candidatesFor }`); only the internal order of arrays inside `byLength` (and therefore of `candidatesFor()`'s returned arrays, and of `constraintPropagation.js`'s Task 3 domains, and of `minConflicts.js`'s `pool` iteration) changes when `freqMap` is supplied.

- [ ] **Step 1: Write the failing test**

Add to `test/dictionary.test.js`:

```js
test('buildDictionary sorts each byLength pool by descending frequency when a freqMap is given', function () {
  var freqMap = new Map([['CHAT', 5], ['CHIC', 50], ['BOIS', 1]]);
  var dico = dictionary.buildDictionary([
    { word: 'CHAT', definitions: ['x'] },
    { word: 'CHIC', definitions: ['x'] },
    { word: 'BOIS', definitions: ['x'] }
  ], freqMap);

  assert.deepStrictEqual(dico.byLength.get(4), ['CHIC', 'CHAT', 'BOIS']);
});

test('buildDictionary treats a word missing from freqMap as frequency 0 (sorted last)', function () {
  var freqMap = new Map([['CHIC', 50]]);
  var dico = dictionary.buildDictionary([
    { word: 'CHAT', definitions: ['x'] },
    { word: 'CHIC', definitions: ['x'] }
  ], freqMap);

  assert.deepStrictEqual(dico.byLength.get(4), ['CHIC', 'CHAT']);
});

test('buildDictionary without a freqMap keeps dico.json insertion order (no regression)', function () {
  var dico = dictionary.buildDictionary([
    { word: 'BOIS', definitions: ['x'] },
    { word: 'CHAT', definitions: ['x'] },
    { word: 'CHIC', definitions: ['x'] }
  ]);

  assert.deepStrictEqual(dico.byLength.get(4), ['BOIS', 'CHAT', 'CHIC']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dictionary.test.js`
Expected: FAIL - `byLength.get(4)` still in insertion order (`['CHAT', 'CHIC', 'BOIS']`), not frequency order.

- [ ] **Step 3: Implement the sort**

In `grid_generator/dictionary.js`, change the function signature on line 1 and add sorting right after the `entries.forEach(...)` block closes (currently the blank line right before `function candidatesFor`):

```js
function buildDictionary(entries, freqMap) {
```

and, after the closing `});` of `entries.forEach`:

```js
  if (freqMap) {
    byLength.forEach(function (words) {
      words.sort(function (a, b) {
        return (freqMap.get(b) || 0) - (freqMap.get(a) || 0);
      });
    });
  }

```

(leave everything else in the file - `crossIndex`, `definitionsByWord`, `candidatesFor`, the final `return` and `module.exports` - unchanged).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dictionary.test.js`
Expected: all tests passing (8 total: 5 pre-existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add grid_generator/dictionary.js test/dictionary.test.js
git commit -m "$(cat <<'EOF'
feat: sort dictionary candidate pools by real word frequency

buildDictionary(entries, freqMap) - optional second argument sorts each
byLength bucket by descending frequency, so backtracking.js and
minConflicts.js both try common words before rare ones. No freqMap ->
unchanged insertion-order behavior (backward compatible).
EOF
)"
```

---

### Task 3: `grid_generator/constraintPropagation.js` - AC-3 domain pruning

**Files:**
- Create: `grid_generator/constraintPropagation.js`
- Test: `test/constraintPropagation.test.js`

**Interfaces:**
- Consumes: `slots` in the exact shape `grid_generator/slots.js::deriveSlots()` produces (`{ axis, cells, length, crossings: [{ slotIndex, ownPos, otherPos }] }`); `dictionary` in the exact shape `grid_generator/dictionary.js::buildDictionary()` returns (only `dictionary.byLength` is used - a `Map<number, string[]>`).
- Produces: `pruneDomains(slots, dictionary)` → either `null` (some slot's domain is empty, skeleton is unsatisfiable) or an `Array<Set<string>>` indexed by slot index (`domains[i]` = surviving candidate words for `slots[i]`). Task 4 (`backtracking.js`) consumes this array shape directly as `options.allowedWords`.

- [ ] **Step 1: Write the failing test**

```js
// test/constraintPropagation.test.js
var test = require('node:test');
var assert = require('node:assert');
var dictionary = require('../grid_generator/dictionary');
var constraintPropagation = require('../grid_generator/constraintPropagation');

test('pruneDomains removes a candidate whose crossing letter has no match in the neighbor domain', function () {
  // H: cells [0,1,2], length 3, crosses V at position 0 (H and V share cell
  // 0, both starting there). V is length 4, so H and V draw from DIFFERENT
  // dictionary.byLength buckets - necessary for this test to isolate one
  // slot's pruning from the other (same-length slots share one pool, so a
  // word "eliminated" from H could simply still be valid AS a V word,
  // which wouldn't exercise real pruning).
  // Only V candidate is 'COWS' (starts with C) - H's 'DOG' (starts with D)
  // can never match and must be pruned; H's 'CAT' (starts with C) survives.
  var dico = dictionary.buildDictionary([
    { word: 'CAT', definitions: ['x'] },
    { word: 'DOG', definitions: ['x'] },
    { word: 'COWS', definitions: ['x'] }
  ]);
  var slots = [
    { axis: 'H', cells: [0, 1, 2], length: 3, crossings: [{ slotIndex: 1, ownPos: 0, otherPos: 0 }] },
    { axis: 'V', cells: [0, 3, 6, 9], length: 4, crossings: [{ slotIndex: 0, ownPos: 0, otherPos: 0 }] }
  ];

  var domains = constraintPropagation.pruneDomains(slots, dico);
  assert.notStrictEqual(domains, null);
  assert.deepStrictEqual(Array.from(domains[0]).sort(), ['CAT']);
  assert.deepStrictEqual(Array.from(domains[1]).sort(), ['COWS']);
});

test('pruneDomains returns null when a slot length has no dictionary words at all', function () {
  var dico = dictionary.buildDictionary([{ word: 'CAT', definitions: ['x'] }]);
  var slots = [{ axis: 'H', cells: [0, 1, 2, 3], length: 4, crossings: [] }];

  assert.strictEqual(constraintPropagation.pruneDomains(slots, dico), null);
});

test('pruneDomains returns null when a crossing constraint eliminates every candidate for a slot', function () {
  // H's ownPos=1 must match V's otherPos=0. Every word in this dictionary
  // has 'A' at position 1 (XAX, YAY) but position 0 is always 'X' or 'Y' -
  // so H's middle letter can never match any V word's first letter.
  // Provably unsatisfiable, with no word-scarcity involved (both slots have
  // 2 full candidates each before propagation).
  var dico = dictionary.buildDictionary([
    { word: 'XAX', definitions: ['x'] },
    { word: 'YAY', definitions: ['x'] }
  ]);
  var slots = [
    { axis: 'H', cells: [0, 1, 2], length: 3, crossings: [{ slotIndex: 1, ownPos: 1, otherPos: 0 }] },
    { axis: 'V', cells: [1, 3, 6], length: 3, crossings: [{ slotIndex: 0, ownPos: 0, otherPos: 1 }] }
  ];

  assert.strictEqual(constraintPropagation.pruneDomains(slots, dico), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/constraintPropagation.test.js`
Expected: FAIL with `Cannot find module '../grid_generator/constraintPropagation'`

- [ ] **Step 3: Write the implementation**

```js
// grid_generator/constraintPropagation.js

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/constraintPropagation.test.js`
Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add grid_generator/constraintPropagation.js test/constraintPropagation.test.js
git commit -m "$(cat <<'EOF'
feat: add AC-3 domain pruning ahead of the fill solver

pruneDomains(slots, dictionary) eliminates dictionary words that can
never survive a crossing constraint, and returns null the instant any
slot's domain empties out - proving a skeleton unsatisfiable without
ever running backtracking's exhaustive search on it. Not yet wired into
generate() - that's the next task.
EOF
)"
```

---

### Task 4: `grid_generator/backtracking.js` - respect an optional pruned-domain restriction

**Files:**
- Modify: `grid_generator/backtracking.js:37-42` (the `domainFor` function)
- Test: `test/backtracking.test.js` (add to existing file)

**Interfaces:**
- Consumes: `options.allowedWords` - optional `Array<Set<string>>` indexed by slot index, in the exact shape Task 3's `pruneDomains()` returns. When absent, behavior is completely unchanged from today.
- Produces: `solve(slots, dictionary, options)` - same return shape as today (`Array<string>` assignment or `null`); no change to its exported signature, callers that don't pass `allowedWords` are unaffected.

- [ ] **Step 1: Write the failing test**

Add to `test/backtracking.test.js`:

```js
test('solve only picks words present in options.allowedWords when it is provided', function () {
  // Without restriction, the solver could pick either DOG or CAT for the
  // single slot (both length 3, no crossings). allowedWords limits it to
  // just CAT.
  var dico = dictionary.buildDictionary([
    { word: 'DOG', definitions: ['x'] },
    { word: 'CAT', definitions: ['x'] }
  ]);
  var slots = [{ axis: 'H', cells: [0, 1, 2], length: 3, crossings: [] }];

  var result = backtracking.solve(slots, dico, { allowedWords: [new Set(['CAT'])] });
  assert.deepStrictEqual(result, ['CAT']);
});

test('solve returns null when allowedWords excludes every candidate for a slot', function () {
  var dico = dictionary.buildDictionary([{ word: 'CAT', definitions: ['x'] }]);
  var slots = [{ axis: 'H', cells: [0, 1, 2], length: 3, crossings: [] }];

  var result = backtracking.solve(slots, dico, { allowedWords: [new Set()] });
  assert.strictEqual(result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/backtracking.test.js`
Expected: FAIL - first new test gets `['DOG']` or `['CAT']` non-deterministically instead of always `['CAT']` (no filtering applied yet); second new test returns `['CAT']` instead of `null`.

- [ ] **Step 3: Implement the filter**

In `grid_generator/backtracking.js`, add right after the existing `var domainCache = new Array(slots.length).fill(null);` line (part of the block already there before `function constraintsFor`):

```js
  var allowedWords = options.allowedWords; // optional Array<Set<string>>, indexed by slot index
```

Then change `domainFor` (currently lines 37-42):

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/backtracking.test.js`
Expected: all tests passing (6 total: 4 pre-existing + 2 new).

- [ ] **Step 5: Run the full suite to confirm no regression elsewhere**

Run: `npm test`
Expected: all tests passing (no count regression from before this task).

- [ ] **Step 6: Commit**

```bash
git add grid_generator/backtracking.js test/backtracking.test.js
git commit -m "$(cat <<'EOF'
feat: let backtracking.solve respect a pre-pruned domain restriction

options.allowedWords (optional Array<Set<string>> indexed by slot
index) intersects with each slot's dynamically-computed candidate list.
Absent option -> unchanged behavior. Wires up constraintPropagation.js's
pruneDomains() output for the next task (scripts/generate-grid.js).
EOF
)"
```

---

### Task 5: Wire pruning + frequency ordering into `scripts/generate-grid.js`

**Files:**
- Modify: `scripts/generate-grid.js:1-9` (requires), `scripts/generate-grid.js:31-56` (the `generate()` attempt loop), `scripts/generate-grid.js:62-89` (the `require.main === module` CLI block)
- Test: `test/generate.test.js` (add to existing file)

**Interfaces:**
- Consumes: Task 3's `pruneDomains(slots, dictionary)`, Task 4's `backtracking.solve(slots, dictionary, { ..., allowedWords })`, Task 1's `buildFrequencyMap(rawText)`, Task 2's `buildDictionary(entries, freqMap)`.
- Produces: `generate()`'s exported signature is unchanged (`generate(nbLines, nbColumns, dictionary, dictionary, options)` stays as-is - pruning is an internal implementation detail of the attempt loop, not a new parameter). The CLI (`require.main === module` block) now loads `data/Lexique4.tsv` in addition to `data/dico.json` and `data/gso-stats.json`.

- [ ] **Step 1: Write the failing test**

Add to `test/generate.test.js`:

```js
test('generate rejects a skeleton whose crossing slots can never mutually agree, at seed 42', function () {
  // Every word here has 'A' at position 1 but 'X'/'Y' (never 'A') at
  // positions 0 and 2 - empirically confirmed (see plan write-up) that at
  // seed 42 with a single usable length of 3, all 5 skeleton attempts
  // involve a crossing that needs position 0 or 2 to match position 1
  // somewhere, which this dictionary can never satisfy - null even with a
  // generous budget (maxBacktracks: 100000), confirming genuine
  // unsatisfiability rather than a starved search.
  var stats = { segmentLengthCounts: { 3: 1 } };
  var dico = dictionary.buildDictionary([
    { word: 'XAX', definitions: ['x'] },
    { word: 'YAY', definitions: ['x'] }
  ]);

  var grid = generateGrid.generate(3, 3, dico, stats, { seed: 42, maxSkeletonAttempts: 5, maxBacktracks: 100000, timeoutMs: 5000 });
  assert.strictEqual(grid, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/generate.test.js`
Expected: this test already passes before Task 5's wiring changes too (confirmed empirically - the dictionary is genuinely unsatisfiable for this seed's skeletons, with or without pruning). It's a regression guard, not a red/green gate for this task - proceed to Step 3; the real proof that pruning is wired in and working is the benchmark script in Task 6.

- [ ] **Step 3: Wire `pruneDomains` into the attempt loop**

In `scripts/generate-grid.js`, add the require near the top (after the existing `var exporterLib = require('../grid_generator/exporter');` line):

```js
var constraintPropagationLib = require('../grid_generator/constraintPropagation');
```

Then, in `generate()`'s attempt loop, change the block that currently reads (around line 49-53):

```js
    if (options.onAttempt) options.onAttempt(attempt + 1, maxSkeletonAttempts, slots.length, false);
    var assignment = backtrackingLib.solve(slots, dictionary, {
      maxBacktracks: options.maxBacktracks !== undefined ? options.maxBacktracks : 2000000,
      timeoutMs: options.timeoutMs !== undefined ? options.timeoutMs : 20000
    });
```

to:

```js
    // Prune before ever calling the solver: an unsatisfiable skeleton is
    // detected here in milliseconds instead of burning the full solver
    // time budget discovering it by exhaustive search.
    var allowedWords = constraintPropagationLib.pruneDomains(slots, dictionary);
    if (!allowedWords) {
      if (options.onAttempt) options.onAttempt(attempt + 1, maxSkeletonAttempts, slots.length, true);
      continue;
    }

    if (options.onAttempt) options.onAttempt(attempt + 1, maxSkeletonAttempts, slots.length, false);
    var assignment = backtrackingLib.solve(slots, dictionary, {
      maxBacktracks: options.maxBacktracks !== undefined ? options.maxBacktracks : 2000000,
      timeoutMs: options.timeoutMs !== undefined ? options.timeoutMs : 20000,
      allowedWords: allowedWords
    });
```

- [ ] **Step 4: Wire frequency-ordered dictionary building into the CLI block**

In `scripts/generate-grid.js`, add the require near the top alongside the other requires:

```js
var lexiqueFrequencyLib = require('../grid_generator/lexiqueFrequency');
```

Then, in the `require.main === module` block, change:

```js
  var dico = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dico.json'), 'utf8'));
  var stats = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'gso-stats.json'), 'utf8'));
  var dictionary = dictionaryLib.buildDictionary(dico);
```

to:

```js
  var dico = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dico.json'), 'utf8'));
  var stats = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'gso-stats.json'), 'utf8'));
  var lexiqueRaw = fs.readFileSync(path.join(__dirname, '..', 'data', 'Lexique4.tsv'), 'utf8');
  var freqMap = lexiqueFrequencyLib.buildFrequencyMap(lexiqueRaw);
  var dictionary = dictionaryLib.buildDictionary(dico, freqMap);
```

- [ ] **Step 5: Run the new and existing generate tests**

Run: `node --test test/generate.test.js`
Expected: all tests passing (5 total: 4 pre-existing + 1 new).

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all tests passing.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-grid.js test/generate.test.js
git commit -m "$(cat <<'EOF'
feat: wire AC-3 pruning and frequency-ordered dictionary into generate()

generate()'s attempt loop now prunes each skeleton's slot domains before
ever calling backtracking.solve() - an unsatisfiable skeleton is
rejected in milliseconds (reusing the existing onAttempt "skipped" flag)
instead of burning the full 20s/2M-backtrack budget discovering it by
exhaustive search. The CLI entrypoint now also loads data/Lexique4.tsv
to sort the dictionary's candidate pools by real word frequency.
EOF
)"
```

---

### Task 6: `scripts/benchmark-fill.js` - manual before/after comparison script

**Files:**
- Create: `scripts/benchmark-fill.js`

**Interfaces:**
- Consumes: `scripts/generate-grid.js`'s exported `mulberry32(seed)`; `grid_generator/skeleton.js::generateSkeleton`; `grid_generator/slots.js::deriveSlots`; `grid_generator/backtracking.js::solve`; `grid_generator/constraintPropagation.js::pruneDomains`; `grid_generator/lexiqueFrequency.js::buildFrequencyMap`; `grid_generator/dictionary.js::buildDictionary`.
- Produces: nothing consumed by other code - a standalone CLI script for human inspection (prints success rate and average time per variant to stdout). Not a unit test, not run by `npm test`.

This is a manual measurement tool, not application logic - there's no "failing test" step; the verification step IS running it and reading the output.

- [ ] **Step 1: Write the script**

```js
// scripts/benchmark-fill.js
// Manual comparison tool (not part of `npm test`) - measures fill success
// rate and time on real skeletons, with today's plain backtracking vs.
// AC-3 pruning + frequency-ordered dictionary, using the SAME skeleton
// sequence for both variants (same rng seed) so the comparison is fair.
//
// Run: node scripts/benchmark-fill.js [nbLines] [nbColumns] [trials]
var fs = require('fs');
var path = require('path');
var dictionaryLib = require('../grid_generator/dictionary');
var skeletonLib = require('../grid_generator/skeleton');
var slotsLib = require('../grid_generator/slots');
var backtrackingLib = require('../grid_generator/backtracking');
var constraintPropagationLib = require('../grid_generator/constraintPropagation');
var lexiqueFrequencyLib = require('../grid_generator/lexiqueFrequency');
var generateGridLib = require('./generate-grid');

var nbLines = parseInt(process.argv[2], 10) || 15;
var nbColumns = parseInt(process.argv[3], 10) || 15;
var trials = parseInt(process.argv[4], 10) || 20;
var timeoutMs = 20000;

var dico = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dico.json'), 'utf8'));
var stats = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'gso-stats.json'), 'utf8'));
var lexiqueRaw = fs.readFileSync(path.join(__dirname, '..', 'data', 'Lexique4.tsv'), 'utf8');
var freqMap = lexiqueFrequencyLib.buildFrequencyMap(lexiqueRaw);

var dictionaryPlain = dictionaryLib.buildDictionary(dico);
var dictionaryRanked = dictionaryLib.buildDictionary(dico, freqMap);

function runVariant(label, dictionary, usePruning) {
  var rng = generateGridLib.mulberry32(1); // fixed seed -> identical skeleton sequence across variants
  var successes = 0;
  var totalMs = 0;

  for (var i = 0; i < trials; i++) {
    var skeleton = skeletonLib.generateSkeleton(nbLines, nbColumns, stats, rng);
    var slots = slotsLib.deriveSlots(skeleton);
    var t0 = Date.now();

    var allowedWords = null;
    if (usePruning) {
      allowedWords = constraintPropagationLib.pruneDomains(slots, dictionary);
      if (!allowedWords) {
        totalMs += Date.now() - t0;
        continue;
      }
    }

    var assignment = backtrackingLib.solve(slots, dictionary, {
      timeoutMs: timeoutMs,
      allowedWords: allowedWords
    });
    totalMs += Date.now() - t0;
    if (assignment) successes++;
  }

  console.log(label + ': ' + successes + '/' + trials + ' succeeded, ' +
    Math.round(totalMs / trials) + 'ms avg/attempt');
}

console.log(nbLines + 'x' + nbColumns + ', ' + trials + ' trials, ' + timeoutMs + 'ms timeout/attempt');
runVariant('BEFORE (plain backtracking, insertion-order dictionary)', dictionaryPlain, false);
runVariant('AFTER  (AC-3 pruning + frequency-ordered dictionary)   ', dictionaryRanked, true);
```

- [ ] **Step 2: Run it and read the output**

Run: `node scripts/benchmark-fill.js 15 15 20`
Expected: two lines printed, e.g. `BEFORE (...): 0/20 succeeded, 20000ms avg/attempt` and `AFTER (...): N/20 succeeded, Mms avg/attempt` - read the actual numbers, don't assume; this is the concrete evidence for whether Tasks 1-5 measurably improved fill reliability. If AFTER's success count isn't clearly better than BEFORE's, that's a real signal to revisit the approach (e.g. consider the out-of-scope MAC/portfolio options from the design spec) rather than something to explain away.

- [ ] **Step 3: Commit**

```bash
git add scripts/benchmark-fill.js
git commit -m "$(cat <<'EOF'
feat: add manual before/after fill-reliability benchmark script

Compares plain backtracking against AC-3 pruning + frequency-ordered
dictionary on the same sequence of real 15x15 skeletons (fixed rng
seed), so Tasks 1-5's actual impact on generation success rate is a
measured number, not an assumption.
EOF
)"
```

---

## Final Verification

- [ ] Run `npm test` one more time - full suite green.
- [ ] Run `node scripts/benchmark-fill.js 15 15 20` and `node scripts/benchmark-fill.js 13 15 20` - record both BEFORE/AFTER numbers to report back.
- [ ] Run `node scripts/generate-grid.js 15 15` once for real (as in every prior manual check in this project) and confirm the resulting `data/generated-grid.json` still passes `grid_generator/validate.js` (see any earlier session's `node -e "..."` validate-grid snippet for the exact check, or just re-run the game locally via `!grid local` per the project's own testing workflow).
