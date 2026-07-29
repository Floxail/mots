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
