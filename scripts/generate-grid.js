// scripts/generate-grid.js
var fs = require('fs');
var path = require('path');
var dictionaryLib = require('../grid_generator/dictionary');
var skeletonLib = require('../grid_generator/skeleton');
var slotsLib = require('../grid_generator/slots');
var backtrackingLib = require('../grid_generator/backtracking');
var exporterLib = require('../grid_generator/exporter');
var validateLib = require('../grid_generator/validate');

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
  // Measured against a real ~24k-word dico at 15x15: a genuinely infeasible
  // skeleton can take ~77s for the solver to exhaustively rule out (not a
  // budget shortfall - it proves no solution exists before either limit is
  // hit). This generator runs offline, once per grid (e.g. a daily cron job),
  // never on a player-facing request path, so there is no real reason to
  // stay near the original <5s aspiration - a few minutes total is an
  // acceptable trade for reliably finding a solvable skeleton.
  var maxSkeletonAttempts = options.maxSkeletonAttempts !== undefined ? options.maxSkeletonAttempts : 40;
  var rng = options.rng || mulberry32(options.seed !== undefined ? options.seed : Date.now());

  for (var attempt = 0; attempt < maxSkeletonAttempts; attempt++) {
    var skeleton = skeletonLib.generateSkeleton(nbLines, nbColumns, stats, rng);
    var slots = slotsLib.deriveSlots(skeleton);
    if (options.onAttempt) options.onAttempt(attempt + 1, maxSkeletonAttempts, slots.length);
    var assignment = backtrackingLib.solve(slots, dictionary, {
      maxBacktracks: options.maxBacktracks !== undefined ? options.maxBacktracks : 2000000,
      timeoutMs: options.timeoutMs !== undefined ? options.timeoutMs : 20000
    });
    if (!assignment) continue;

    var grid = exporterLib.exportGrid(skeleton, slots, assignment, dictionary);
    if (validateLib.validateGrid(grid).valid) return grid;
  }
  return null;
}

if (require.main === module) {
  var size = parseInt(process.argv[2], 10) || 15;
  var dico = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dico.json'), 'utf8'));
  var stats = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'gso-stats.json'), 'utf8'));
  var dictionary = dictionaryLib.buildDictionary(dico);

  var grid = generate(size, size, dictionary, stats, {
    onAttempt: function (n, total, nbSlots) {
      console.log('Tentative ' + n + '/' + total + ' (' + nbSlots + ' slots)...');
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
