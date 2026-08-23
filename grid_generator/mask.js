var LETTER = 'L';
var DEF = 'D';

// Arrow types: where the word starts relative to the def cell, and its axis.
// R : starts right, runs right (H)   RB: starts right, runs down (V, bent)
// B : starts below, runs down  (V)   BR: starts below, runs right (H, bent)
var ARROWS = ['R', 'RB', 'B', 'BR'];
// Pair combinations observed in real GSO grids
var ARROW_PAIRS = [['R', 'B'], ['RB', 'B'], ['R', 'BR'], ['B', 'BR'], ['RB', 'BR']];

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

function arrowAxis(arrow) {
  return (arrow === 'R' || arrow === 'BR') ? 'H' : 'V';
}

// index of the word's first cell for an arrow on def cell idx, or -1 if off-grid
function arrowStart(mask, idx, arrow) {
  var col = idx % mask.nbLines;
  var row = (idx - col) / mask.nbLines;
  if (arrow === 'R' || arrow === 'RB') return col + 1 < mask.nbLines ? idx + 1 : -1;
  return row + 1 < mask.nbColumns ? idx + mask.nbLines : -1;
}

function walkWord(mask, start, axis) {
  var cells = [];
  if (start === -1) return cells;
  var col = start % mask.nbLines;
  var row = (start - col) / mask.nbLines;
  while (row < mask.nbColumns && col < mask.nbLines &&
         mask.cells[row * mask.nbLines + col].kind === LETTER) {
    cells.push(row * mask.nbLines + col);
    if (axis === 'H') col++; else row++;
  }
  return cells;
}

function deriveWords(mask) {
  var words = [];
  mask.cells.forEach(function (cell, idx) {
    if (cell.kind !== DEF) return;
    cell.arrows.forEach(function (arrow, arrowIndex) {
      var axis = arrowAxis(arrow);
      words.push({
        axis: axis,
        cells: walkWord(mask, arrowStart(mask, idx, arrow), axis),
        defCell: idx,
        arrowIndex: arrowIndex,
        arrow: arrow
      });
    });
  });
  return words;
}

module.exports = {
  LETTER: LETTER,
  DEF: DEF,
  ARROWS: ARROWS,
  ARROW_PAIRS: ARROW_PAIRS,
  arrowAxis: arrowAxis,
  deriveWords: deriveWords,
  mulberry32: mulberry32
};
