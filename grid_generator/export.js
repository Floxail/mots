var Case = require('../game_files/case');

// Client contract (public/javascripts/game/grid.js createDescriptionArrows):
// 0=Right, 1=RightBottom (bent), 2=Bottom, 3=BottomRight (bent).
// This is gridManager.js's local enumArrow, NOT enums.ArrowDirections.
var ARROW_CODES = { R: 0, RB: 1, B: 2, BR: 3 };

// Definitions in real GSO grids run 13-22 characters, median 17 (measured over
// 1409 clues in 51 grids). Taking the shortest available - what this used to do
// - lands well under that: for 80% of dictionary entries the shortest option is
// a bare one-word synonym, which reads as thin rather than as a clue, and is
// also where the scraped data's occasional wrong pair hides (SURMENEE's
// shortest definition is "OISIVE", its opposite, while every sensible one is
// longer). Aiming at the median keeps clues in the register real grids use.
// A pick that still overflows its cell is not a problem: mfl.css truncates
// .description span with an ellipsis and clicking the cell opens the full
// text in #desc-popup.
var TARGET_DEFINITION_LENGTH = 17;

function bestDefinition(defs) {
  return defs.reduce(function (best, d) {
    var gap = Math.abs(d.length - TARGET_DEFINITION_LENGTH);
    var bestGap = Math.abs(best.length - TARGET_DEFINITION_LENGTH);
    if (gap !== bestGap) return gap < bestGap ? d : best;
    return d.length < best.length ? d : best; // tie: shorter, so the pick is deterministic
  });
}

function exportGrid(mask, slots, assignment, dictionary) {
  var cases = mask.cells.map(function (cell, idx) {
    if (cell.kind === 'L') return new Case.LetterCase(idx, null);
    // null, not a GSO character: this cell's nbDesc/desc/arrow are set below
    // from the mask/slots, not derived from a character. A hardcoded 'a'
    // would silently look like a real GSO single-Right-arrow cell to
    // gridManager.js's exported placeArrows() if a future caller ran it over
    // a generated grid, rewriting every def cell to one Right arrow.
    return new Case.DescriptionCase(idx, null);
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
      target.desc.push(defs.length > 0 ? bestDefinition(defs) : '');
      target.arrow.push(ARROW_CODES[arrow]);
    });
  });

  return { nbLines: mask.nbLines, nbColumns: mask.nbColumns, nbWords: slots.length, cases: cases };
}

module.exports = { exportGrid: exportGrid, ARROW_CODES: ARROW_CODES };
