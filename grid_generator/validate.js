// grid_generator/validate.js
var enums = require('../game_files/enums');

// arrow codes as exported by export.js (client contract):
// 0=R (start right, run H) 1=RB (start right, run V) 2=B (start below, run V) 3=BR (start below, run H)
function arrowGeometry(grid, idx, code) {
  var col = idx % grid.nbLines;
  var row = (idx - col) / grid.nbLines;
  var startsRight = code === 0 || code === 1;
  var axis = (code === 0 || code === 3) ? 'H' : 'V';
  var start;
  if (startsRight) start = col + 1 < grid.nbLines ? idx + 1 : -1;
  else start = row + 1 < grid.nbColumns ? idx + grid.nbLines : -1;
  return { start: start, axis: axis };
}

function walk(grid, start, axis) {
  var cells = [];
  if (start === -1) return cells;
  var col = start % grid.nbLines;
  var row = (start - col) / grid.nbLines;
  while (row < grid.nbColumns && col < grid.nbLines &&
         grid.cases[row * grid.nbLines + col].type === enums.CaseType.Letter) {
    cells.push(row * grid.nbLines + col);
    if (axis === 'H') col++; else row++;
  }
  return cells;
}

// all maximal Letter runs (any length >= 1) along one axis
function scanRuns(grid, axis) {
  var runs = [];
  var outerCount = axis === 'H' ? grid.nbColumns : grid.nbLines;
  var innerCount = axis === 'H' ? grid.nbLines : grid.nbColumns;
  for (var outer = 0; outer < outerCount; outer++) {
    var run = [];
    for (var inner = 0; inner < innerCount; inner++) {
      var idx = axis === 'H' ? outer * grid.nbLines + inner : inner * grid.nbLines + outer;
      if (grid.cases[idx].type === enums.CaseType.Letter) run.push(idx);
      else if (run.length) { runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);
  }
  return runs;
}

function validateGrid(grid, dictionary) {
  var errors = [];
  var words = [];

  if (grid.cases.length !== grid.nbLines * grid.nbColumns) {
    errors.push('Dimensions incoherentes: ' + grid.cases.length + ' cases pour ' + grid.nbLines + 'x' + grid.nbColumns);
    return { valid: false, errors: errors };
  }

  grid.cases.forEach(function (cell, idx) {
    if (cell.type === enums.CaseType.Letter) {
      if (!cell.value || !/^[A-Z]$/.test(cell.value)) errors.push('Case lettre sans valeur valide a index ' + idx);
      return;
    }
    if (cell.type !== enums.CaseType.Description) {
      errors.push('Type de case inconnu a index ' + idx);
      return;
    }
    if (!cell.arrow || !cell.desc || cell.arrow.length !== cell.nbDesc) {
      errors.push('Case description incoherente a index ' + idx);
      return;
    }
    cell.arrow.forEach(function (code, i) {
      var geo = arrowGeometry(grid, idx, code);
      var cells = walk(grid, geo.start, geo.axis);
      if (cells.length < 2) errors.push('Mot de longueur ' + cells.length + ' (fleche ' + i + ', case ' + idx + ')');
      if (!cell.desc[i]) errors.push('Definition manquante (fleche ' + i + ', case ' + idx + ')');
      words.push({
        axis: geo.axis,
        cells: cells,
        key: geo.axis + ':' + cells.join(','),
        value: cells.map(function (c) { return grid.cases[c].value; }).join('')
      });
    });
  });

  // duplicates + dictionary membership
  var seen = new Set();
  words.forEach(function (w) {
    if (w.cells.length < 2) return;
    if (seen.has(w.value)) errors.push('Mot en double: ' + w.value);
    seen.add(w.value);
    if (dictionary && !dictionary.definitionsByWord.has(w.value)) errors.push('Mot hors dico: ' + w.value);
  });

  // run/word equivalence: every arrow word is a maximal run, every run >= 2 is
  // clued exactly once, every 1-cell run is covered by the perpendicular axis
  ['H', 'V'].forEach(function (axis) {
    var axisWords = words.filter(function (w) { return w.axis === axis; });
    var wordKeys = new Map();
    axisWords.forEach(function (w) {
      if (wordKeys.has(w.key)) errors.push('Mot clue deux fois (' + w.key + ')');
      wordKeys.set(w.key, w);
    });
    var runKeys = new Set();
    scanRuns(grid, axis).forEach(function (run) {
      var key = axis + ':' + run.join(',');
      runKeys.add(key);
      if (run.length >= 2 && !wordKeys.has(key)) {
        errors.push('Run ' + axis + ' non clue ou fusionne a partir de la case ' + run[0]);
      }
    });
    wordKeys.forEach(function (w, key) {
      if (w.cells.length >= 2 && !runKeys.has(key)) {
        errors.push('Mot non maximal (demarre ou finit en plein run): ' + key);
      }
    });
  });

  // 1-cell runs must be crossed by the other axis
  var coveredByWord = new Set();
  words.forEach(function (w) { w.cells.forEach(function (c) { coveredByWord.add(w.axis + c); }); });
  ['H', 'V'].forEach(function (axis) {
    var other = axis === 'H' ? 'V' : 'H';
    scanRuns(grid, axis).forEach(function (run) {
      if (run.length === 1 && !coveredByWord.has(other + run[0])) {
        errors.push('Case lettre orpheline (non couverte) a index ' + run[0]);
      }
    });
  });

  return { valid: errors.length === 0, errors: errors };
}

module.exports = { validateGrid: validateGrid };
