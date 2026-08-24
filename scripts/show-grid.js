// scripts/show-grid.js
// Prints a generated grid's solution and every clue with the word it points at,
// checking each definition really belongs to that word in the dictionary.
//
//   node scripts/show-grid.js                     -> data/generated-grid.json
//   node scripts/show-grid.js path/to/grid.json
var fs = require('fs');
var path = require('path');
var enums = require('../game_files/enums');
var dictionaryLib = require('../grid_generator/dictionary');
// Resolve arrows through the validator's own helpers, so this tool can never
// disagree with the code that decides whether a grid is valid.
var validateLib = require('../grid_generator/validate');

// Arrow codes are gridManager's local enum, the client renderer's contract:
// 0=Right, 1=RightBottom (bent), 2=Bottom, 3=BottomRight (bent).
var ARROW_LABEL = { 0: '→', 1: '→↓', 2: '↓', 3: '↓→' };

function readWord(grid, start, axis) {
  return validateLib.walk(grid, start, axis).map(function (idx) {
    return grid.cases[idx].value;
  }).join('');
}

function renderSolution(grid) {
  var lines = [];
  for (var row = 0; row < grid.nbColumns; row++) {
    var out = '';
    for (var col = 0; col < grid.nbLines; col++) {
      var cell = grid.cases[row * grid.nbLines + col];
      if (cell.type === enums.CaseType.Letter) out += ' ' + cell.value;
      else out += ' ' + (cell.nbDesc === 2 ? '█' : '▓');
    }
    lines.push(out);
  }
  return lines.join('\n');
}

function collectClues(grid) {
  var clues = [];
  grid.cases.forEach(function (cell, idx) {
    if (cell.type !== enums.CaseType.Description) return;
    (cell.arrow || []).forEach(function (code, i) {
      var geo = validateLib.arrowGeometry(grid, idx, code);
      var col = idx % grid.nbLines;
      clues.push({
        row: (idx - col) / grid.nbLines,
        col: col,
        arrow: ARROW_LABEL[code] || ('?' + code),
        definition: cell.desc[i],
        word: readWord(grid, geo.start, geo.axis)
      });
    });
  });
  return clues;
}

function main() {
  var gridPath = process.argv[2] || path.join(__dirname, '..', 'data', 'generated-grid.json');
  var grid = JSON.parse(fs.readFileSync(gridPath, 'utf8'));

  // Same dictionary the generator drew from, so "does this definition belong to
  // this word" is answered against the real source, not re-derived here.
  var dico = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dico.json'), 'utf8'));
  var dictionary = dictionaryLib.buildDictionary(dico);

  console.log('Grille ' + grid.nbLines + 'x' + grid.nbColumns + ' - ' + grid.nbWords + ' mots');
  console.log('(' + '▓' + ' = 1 definition, ' + '█' + ' = 2 definitions)\n');
  console.log(renderSolution(grid));

  var clues = collectClues(grid);
  console.log('\n' + clues.length + ' definitions :\n');

  var mismatches = 0;
  clues.forEach(function (clue) {
    var known = dictionary.definitionsByWord.get(clue.word);
    var ok = known && known.indexOf(clue.definition) !== -1;
    if (!ok) mismatches++;
    var where = '(' + clue.row + ',' + clue.col + ')' + clue.arrow;
    console.log((ok ? '  ' : '  !! ') + where.padEnd(10) + clue.word.padEnd(14) + clue.definition);
    if (!ok) {
      console.log('       ^ cette definition n\'est pas listee pour ce mot dans dico.json' +
                  (known ? ' (attendu : ' + known.join(' / ') + ')' : ' (mot absent du dico)'));
    }
  });

  console.log('\n' + (clues.length - mismatches) + '/' + clues.length +
              ' definitions correspondent au mot qu\'elles pointent' +
              (mismatches ? ' - ' + mismatches + ' PROBLEME(S)' : ''));
  if (mismatches) process.exit(1);
}

if (require.main === module) main();

module.exports = { collectClues: collectClues, renderSolution: renderSolution };
