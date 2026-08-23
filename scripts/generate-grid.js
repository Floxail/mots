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
  var maxMaskAttempts = options.maxMaskAttempts !== undefined ? options.maxMaskAttempts : 30;
  var rng = options.rng || maskLib.mulberry32(options.seed !== undefined ? options.seed : Date.now());

  for (var attempt = 0; attempt < maxMaskAttempts; attempt++) {
    var mask = maskLib.generateMask(nbLines, nbColumns, rng, {
      weights: options.weights,
      maxStale: options.maxStale
    });
    var slots = maskLib.deriveSlots(mask);
    if (!slots) continue; // hillclimber went stale on an invalid mask - next seed
    if (options.onAttempt) options.onAttempt(attempt + 1, maxMaskAttempts, slots.length, mask.penalty);

    var assignment = fillLib.solve(slots, dictionary, {
      maxBacktracks: options.maxBacktracks,
      timeoutMs: options.timeoutMs
    });
    if (!assignment) continue;

    var grid = exportLib.exportGrid(mask, slots, assignment, dictionary);
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
