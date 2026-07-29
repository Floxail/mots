// scripts/generate-grid.js
var fs = require('fs');
var path = require('path');
var dictionaryLib = require('../grid_generator/dictionary');
var skeletonLib = require('../grid_generator/skeleton');
var slotsLib = require('../grid_generator/slots');
var backtrackingLib = require('../grid_generator/backtracking');
var exporterLib = require('../grid_generator/exporter');
var validateLib = require('../grid_generator/validate');
var lexiqueFrequencyLib = require('../grid_generator/lexiqueFrequency');

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

function generate(nbLines, nbColumns, dictionary, stats, options) {
  options = options || {};
  // Two rounds of investigation (docs/superpowers/specs/2026-07-28 and
  // 2026-07-29) tried to make individual attempts smarter or faster
  // (static AC-3 pruning, then a word-first constructive fill) and neither
  // held up: AC-3 barely prunes a 56k-word dictionary and added net
  // overhead; word-first hit a structural bug (independently-chosen runs
  // silently merging into non-words via slots.js) that a pure greedy,
  // no-backtracking fill also failed 0/100 to work around - confirming
  // backtracking itself is structurally necessary at this scale, not just
  // "not smart enough". The only thing that has ever produced a real
  // 15x15 grid in this whole investigation is this plain backtracking
  // solver, rarely and slowly. This generator runs offline, once per grid
  // (e.g. a daily cron job), never on a player-facing request path, so a
  // large time budget here is an acceptable trade for reliability.
  var maxSkeletonAttempts = options.maxSkeletonAttempts !== undefined ? options.maxSkeletonAttempts : 40;
  var rng = options.rng || mulberry32(options.seed !== undefined ? options.seed : Date.now());

  for (var attempt = 0; attempt < maxSkeletonAttempts; attempt++) {
    var skeleton = skeletonLib.generateSkeleton(nbLines, nbColumns, stats, rng);
    var slots = slotsLib.deriveSlots(skeleton);

    // Deriving a skeleton is cheap (milliseconds); solving one is not (up to
    // timeoutMs). Slot count is the strongest available predictor of how hard
    // a skeleton will be to solve, so reject one outside the desired range
    // before spending any solver budget on it at all.
    var tooManySlots = options.maxSlots !== undefined && slots.length > options.maxSlots;
    var tooFewSlots = options.minSlots !== undefined && slots.length < options.minSlots;
    if (tooManySlots || tooFewSlots) {
      if (options.onAttempt) options.onAttempt(attempt + 1, maxSkeletonAttempts, slots.length, true);
      continue;
    }

    if (options.onAttempt) options.onAttempt(attempt + 1, maxSkeletonAttempts, slots.length, false);
    var assignment = backtrackingLib.solve(slots, dictionary, {
      maxBacktracks: options.maxBacktracks !== undefined ? options.maxBacktracks : 50000000,
      timeoutMs: options.timeoutMs !== undefined ? options.timeoutMs : 300000
    });
    if (!assignment) continue;

    var grid = exporterLib.exportGrid(skeleton, slots, assignment, dictionary);
    if (validateLib.validateGrid(grid).valid) return grid;
  }
  return null;
}

if (require.main === module) {
  // node scripts/generate-grid.js 15             -> 15x15 (square)
  // node scripts/generate-grid.js 13 15          -> 13 wide x 15 tall (rectangular)
  // node scripts/generate-grid.js 15 15 50       -> 15x15, skip any skeleton with more than 50 slots
  // node scripts/generate-grid.js 13 15 60 40    -> 13x15, only attempt skeletons with 40-60 slots
  var nbLines = parseInt(process.argv[2], 10) || 15;
  var nbColumns = parseInt(process.argv[3], 10) || nbLines;
  var maxSlots = process.argv[4] !== undefined ? parseInt(process.argv[4], 10) : undefined;
  var minSlots = process.argv[5] !== undefined ? parseInt(process.argv[5], 10) : undefined;
  var dico = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dico.json'), 'utf8'));
  var stats = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'gso-stats.json'), 'utf8'));
  var lexiqueRaw = fs.readFileSync(path.join(__dirname, '..', 'data', 'Lexique4.tsv'), 'utf8');
  var freqMap = lexiqueFrequencyLib.buildFrequencyMap(lexiqueRaw);
  var dictionary = dictionaryLib.buildDictionary(dico, freqMap);

  var grid = generate(nbLines, nbColumns, dictionary, stats, {
    maxSlots: maxSlots,
    minSlots: minSlots,
    onAttempt: function (n, total, nbSlots, skipped) {
      console.log('Tentative ' + n + '/' + total + ' (' + nbSlots + ' slots)' + (skipped ? ' - ignoree (hors plage)' : '...'));
    }
  });
  if (!grid) {
    console.error('Echec de generation apres plusieurs tentatives.');
    process.exit(1);
  }

  fs.writeFileSync(path.join(__dirname, '..', 'data', 'generated-grid.json'), JSON.stringify(grid, null, 2));
  console.log('Grille generee: data/generated-grid.json');
}

module.exports = { generate: generate, mulberry32: mulberry32 };
