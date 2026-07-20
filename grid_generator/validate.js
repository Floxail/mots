var enums = require('../game_files/enums');

function hasMultiCellRun(grid, index, axis) {
  var nbLines = grid.nbLines;
  var row = Math.floor(index / nbLines);
  var col = index % nbLines;
  var count = 1;

  if (axis === 'H') {
    var c = col - 1;
    while (c >= 0 && grid.cases[row * nbLines + c].type === enums.CaseType.Letter) { count++; c--; }
    c = col + 1;
    while (c < nbLines && grid.cases[row * nbLines + c].type === enums.CaseType.Letter) { count++; c++; }
  } else {
    var r = row - 1;
    while (r >= 0 && grid.cases[r * nbLines + col].type === enums.CaseType.Letter) { count++; r--; }
    r = row + 1;
    while (r < grid.nbColumns && grid.cases[r * nbLines + col].type === enums.CaseType.Letter) { count++; r++; }
  }
  return count >= 2;
}

function validateGrid(grid) {
  var errors = [];

  grid.cases.forEach(function (cell, idx) {
    if (cell.type === enums.CaseType.Letter) {
      if (!hasMultiCellRun(grid, idx, 'H') && !hasMultiCellRun(grid, idx, 'V')) {
        errors.push('Case orpheline a index ' + idx);
      }
    } else if (cell.type === enums.CaseType.Description) {
      if (!cell.desc || cell.desc.length === 0 || !cell.desc[0]) {
        errors.push('Case description sans definition a index ' + idx);
      }
    }
  });

  return { valid: errors.length === 0, errors: errors };
}

module.exports = { validateGrid: validateGrid };
