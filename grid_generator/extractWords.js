var enums = require('../game_files/enums');

function stripHtml(text) {
  return text.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeWord(raw) {
  return raw.normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').toUpperCase();
}

function readRun(cases, nbLines, startIndex, axis) {
  var step = axis === 'H' ? 1 : nbLines;
  var word = '';
  var index = startIndex;
  while (index < cases.length && cases[index] && cases[index].type === enums.CaseType.Letter) {
    if (axis === 'H' && index % nbLines === 0 && word.length > 0) break;
    word += cases[index].value;
    index += step;
  }
  return word;
}

function extractWordDefPairs(grid) {
  var pairs = [];

  grid.cases.forEach(function (cell, idx) {
    if (cell.type !== enums.CaseType.Description) return;

    var hasRightLetter = ((idx % grid.nbLines) + 1 < grid.nbLines) &&
      grid.cases[idx + 1] && grid.cases[idx + 1].type === enums.CaseType.Letter;
    var hasBelowLetter = (idx + grid.nbLines < grid.cases.length) &&
      grid.cases[idx + grid.nbLines] && grid.cases[idx + grid.nbLines].type === enums.CaseType.Letter;

    var directions = [];
    if (hasRightLetter) directions.push('H');
    if (hasBelowLetter) directions.push('V');

    for (var i = 0; i < cell.nbDesc && i < directions.length; i++) {
      var axis = directions[i];
      var startIndex = axis === 'H' ? idx + 1 : idx + grid.nbLines;
      var word = readRun(grid.cases, grid.nbLines, startIndex, axis);
      var def = cell.desc[i];
      if (word.length >= 2 && def) {
        pairs.push({ word: normalizeWord(word), definition: stripHtml(def) });
      }
    }
  });

  return pairs;
}

module.exports = {
  extractWordDefPairs: extractWordDefPairs,
  normalizeWord: normalizeWord,
  stripHtml: stripHtml
};
