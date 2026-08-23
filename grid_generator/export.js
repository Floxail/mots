var Case = require('../game_files/case');

// Client contract (public/javascripts/game/grid.js createDescriptionArrows):
// 0=Right, 1=RightBottom (bent), 2=Bottom, 3=BottomRight (bent).
// This is gridManager.js's local enumArrow, NOT enums.ArrowDirections.
var ARROW_CODES = { R: 0, RB: 1, B: 2, BR: 3 };

function shortestDefinition(defs) {
  return defs.reduce(function (shortest, d) { return d.length < shortest.length ? d : shortest; });
}

function exportGrid(mask, slots, assignment, dictionary) {
  var cases = mask.cells.map(function (cell, idx) {
    if (cell.kind === 'L') return new Case.LetterCase(idx, null);
    return new Case.DescriptionCase(idx, 'a');
  });

  var slotByArrow = new Map(); // defCell * 2 + arrowIndex -> slot index
  slots.forEach(function (slot, slotIdx) {
    slotByArrow.set(slot.defCell * 2 + slot.arrowIndex, slotIdx);
    slot.cells.forEach(function (cellIndex, pos) {
      cases[cellIndex].value = assignment[slotIdx][pos];
    });
  });

  mask.cells.forEach(function (cell, idx) {
    if (cell.kind !== 'D') return;
    var target = cases[idx];
    target.nbDesc = cell.arrows.length;
    target.nbLines = cell.arrows.length;
    target.desc = [];
    target.arrow = [];
    cell.arrows.forEach(function (arrow, arrowIndex) {
      var slotIdx = slotByArrow.get(idx * 2 + arrowIndex);
      var defs = dictionary.definitionsByWord.get(assignment[slotIdx]) || [];
      target.desc.push(defs.length > 0 ? shortestDefinition(defs) : '');
      target.arrow.push(ARROW_CODES[arrow]);
    });
  });

  return { nbLines: mask.nbLines, nbColumns: mask.nbColumns, nbWords: slots.length, cases: cases };
}

module.exports = { exportGrid: exportGrid, ARROW_CODES: ARROW_CODES };
