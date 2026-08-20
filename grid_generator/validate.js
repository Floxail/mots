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

// A word can only be clued by a Description cell immediately to its left (H)
// or above it (V) - exportGrid attaches definitions that way, matching real
// GSO clue placement. Column 0 has no left neighbor and row 0 has no cell
// above, so a Letter run starting right on that edge can never be clued,
// even though hasMultiCellRun happily accepts it as a normal run.
function hasUnclueableEdgeStart(grid, idx) {
  var nbLines = grid.nbLines;
  var col = idx % nbLines;
  if (col === 0 && grid.cases[idx + 1] && grid.cases[idx + 1].type === enums.CaseType.Letter) return true;
  if (idx - nbLines < 0 && grid.cases[idx + nbLines] && grid.cases[idx + nbLines].type === enums.CaseType.Letter) return true;
  return false;
}

function validateGrid(grid) {
  var errors = [];

  grid.cases.forEach(function (cell, idx) {
    if (cell.type === enums.CaseType.Letter) {
      if (!hasMultiCellRun(grid, idx, 'H') && !hasMultiCellRun(grid, idx, 'V')) {
        errors.push('Case orpheline a index ' + idx);
      }
      if (hasUnclueableEdgeStart(grid, idx)) {
        errors.push('Mot commence en bord de grille sans case description a index ' + idx);
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
