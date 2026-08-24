// scripts/daily-grid.js
// Generates one 15x15 grid and files it in data/grids/ under the next free
// number, so past days stay replayable via "!grid local <N>".
//
// Meant to be run from cron on the game server, once a night:
//   0 0 * * * cd /srv/mots && /usr/bin/node scripts/daily-grid.js >> logs/daily-grid.log 2>&1
//
// Generation is CPU-bound and takes several minutes, which is why this runs as
// its own process: doing it inside the game server would block its event loop
// and freeze every game in progress for the duration.
//
//   node scripts/daily-grid.js            -> 15x15
//   node scripts/daily-grid.js 13 15      -> 13 wide x 15 tall
var fs = require('fs');
var path = require('path');
var dictionaryLib = require('../grid_generator/dictionary');
var lexiqueFrequencyLib = require('../grid_generator/lexiqueFrequency');
var generateGrid = require('./generate-grid');
var GridManager = require('../game_files/gridManager');

function nextGridNumber() {
  var existing = GridManager.listLocalGrids();
  return existing.length === 0 ? 1 : existing[existing.length - 1] + 1;
}

function main() {
  var nbLines = parseInt(process.argv[2], 10) || 15;
  var nbColumns = parseInt(process.argv[3], 10) || nbLines;
  var startedAt = Date.now();
  var stamp = new Date().toISOString();

  console.log('[' + stamp + '] Generation ' + nbLines + 'x' + nbColumns + '...');

  var dataDir = path.join(__dirname, '..', 'data');
  var dico = JSON.parse(fs.readFileSync(path.join(dataDir, 'dico.json'), 'utf8'));
  var lexiqueRaw = fs.readFileSync(path.join(dataDir, 'Lexique4.tsv'), 'utf8');
  var dictionary = dictionaryLib.buildDictionary(dico, lexiqueFrequencyLib.buildFrequencyMap(lexiqueRaw));

  var grid = generateGrid.generate(nbLines, nbColumns, dictionary);
  if (!grid) {
    console.error('[' + new Date().toISOString() + '] Echec: aucune grille valide generee.');
    process.exit(1);
  }

  grid.generated = stamp;

  // Claim the number as late as possible: a run that took ten minutes should
  // not overwrite a grid another run filed in the meantime.
  fs.mkdirSync(GridManager.LOCAL_GRID_DIR, { recursive: true });
  var number = nextGridNumber();
  var target = GridManager.localGridPath(number);
  if (fs.existsSync(target)) {
    console.error('[' + new Date().toISOString() + '] Echec: ' + target + ' existe deja.');
    process.exit(1);
  }
  fs.writeFileSync(target, JSON.stringify(grid, null, 2));

  var seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log('[' + new Date().toISOString() + '] Grille locale #' + number + ' ecrite (' +
              grid.nbWords + ' mots, ' + seconds + 's) -> ' + target);
}

if (require.main === module) main();

module.exports = { nextGridNumber: nextGridNumber };
