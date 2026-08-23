// scripts/generate-grid.js
var fs = require('fs');
var path = require('path');
var dictionaryLib = require('../grid_generator/dictionary');
var maskLib = require('../grid_generator/mask');
var fillLib = require('../grid_generator/fill');
var exportLib = require('../grid_generator/export');
var validateLib = require('../grid_generator/validate');
var lexiqueFrequencyLib = require('../grid_generator/lexiqueFrequency');

function generate(nbLines, nbColumns, dictionary, options) {
  options = options || {};
  // 60 attempts yields roughly 8 valid masks at 15x15 (about a quarter of
  // attempts converge), which is enough spread for the penalty sort to have
  // something to choose between without the collection phase dominating.
  var maxMaskAttempts = options.maxMaskAttempts !== undefined ? options.maxMaskAttempts : 60;
  var maskPoolSize = options.maskPoolSize !== undefined ? options.maskPoolSize : 8;
  var rng = options.rng || maskLib.mulberry32(options.seed !== undefined ? options.seed : Date.now());

  // The mask penalty measures exactly the structural quality we want - it is
  // calibrated against 51 real GSO grids - so the mask that fills first is not
  // the mask we want, it is merely the luckiest. Measured over 8 real 15x15
  // generations, taking the first fillable mask met all four structural
  // targets 1 time in 8. Collect the valid masks, then try them in ascending
  // penalty order: the first one that fills is the best-structured mask that
  // is actually fillable. Raising the penalty weights instead is the wrong
  // lever - Task 11 measured that it collapses convergence.
  var pool = [];
  for (var attempt = 0; attempt < maxMaskAttempts && pool.length < maskPoolSize; attempt++) {
    var mask = maskLib.generateMask(nbLines, nbColumns, rng, {
      weights: options.weights,
      maxStale: options.maxStale
    });
    var slots = maskLib.deriveSlots(mask);
    if (!slots) continue; // hillclimber went stale on an invalid mask - next seed
    if (options.onAttempt) options.onAttempt(attempt + 1, maxMaskAttempts, slots.length, mask.penalty);
    pool.push({ mask: mask, slots: slots });
  }

  pool.sort(function (a, b) { return a.mask.penalty - b.mask.penalty; });

  for (var i = 0; i < pool.length; i++) {
    if (options.onSelect) options.onSelect(pool.length, i + 1, pool[i].mask.penalty);

    var assignment = fillLib.solve(pool[i].slots, dictionary, {
      maxBacktracks: options.maxBacktracks,
      timeoutMs: options.timeoutMs
    });
    if (!assignment) continue;

    var grid = exportLib.exportGrid(pool[i].mask, pool[i].slots, assignment, dictionary);
    if (validateLib.validateGrid(grid, dictionary).valid) return grid;
  }
  return null;
}

if (require.main === module) {
  // node scripts/generate-grid.js 15       -> 15x15
  // node scripts/generate-grid.js 13 15    -> 13 wide x 15 tall
  var nbLines = parseInt(process.argv[2], 10) || 15;
  var nbColumns = parseInt(process.argv[3], 10) || nbLines;
  var dico = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dico.json'), 'utf8'));
  var lexiqueRaw = fs.readFileSync(path.join(__dirname, '..', 'data', 'Lexique4.tsv'), 'utf8');
  var dictionary = dictionaryLib.buildDictionary(dico, lexiqueFrequencyLib.buildFrequencyMap(lexiqueRaw));

  var grid = generate(nbLines, nbColumns, dictionary, {
    onAttempt: function (n, total, nbSlots, penalty) {
      console.log('Tentative ' + n + '/' + total + ' (' + nbSlots + ' slots, penalite masque ' + penalty + ')...');
    },
    onSelect: function (poolSize, rank, penalty) {
      console.log('Remplissage du masque ' + rank + '/' + poolSize + ' (penalite ' + penalty + ')...');
    }
  });
  if (!grid) {
    console.error('Echec de generation apres plusieurs tentatives.');
    process.exit(1);
  }

  fs.writeFileSync(path.join(__dirname, '..', 'data', 'generated-grid.json'), JSON.stringify(grid, null, 2));
  console.log('Grille generee: data/generated-grid.json');
}

module.exports = { generate: generate, mulberry32: maskLib.mulberry32 };
