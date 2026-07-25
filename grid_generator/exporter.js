var enums = require('../game_files/enums');
var Case = require('../game_files/case');

// NOT enums.ArrowDirections (Right:1, Bottom:2) - the front-end renderer
// (public/javascripts/game/grid.js createDescriptionArrows, documented at its
// top as "dir: 0=Right, 1=RightBottom, 2=Bottom, 3=BottomRight") checks
// dir===0 for Right and dir===2 for Bottom. This matches gridManager.js's own
// *local* enumArrow (Right:0, Bottom:2), which is what every real GSO grid's
// arrow values have always used - not the shared enum. Confirmed via
// graphify extraction flagging the enumArrow/ArrowDirections mismatch as
// AMBIGUOUS; a prior fix here wrongly "corrected" this to the shared enum's
// Right=1, which the renderer does not recognize as Right at all.
var ARROW_RIGHT = 0;
var ARROW_BOTTOM = 2;

function findSlotStartingAt(slots, cellIndex, axis) {
  for (var i = 0; i < slots.length; i++) {
    if (slots[i].axis === axis && slots[i].cells[0] === cellIndex) return i;
  }
  return -1;
}

function exportGrid(skeleton, slots, assignment, dictionary) {
  var nbLines = skeleton.nbLines, nbColumns = skeleton.nbColumns;

  var cases = skeleton.types.map(function (type, idx) {
    if (type === enums.CaseType.Letter) return new Case.LetterCase(idx, null);
    return new Case.DescriptionCase(idx, 'a');
  });

  slots.forEach(function (slot, slotIdx) {
    var word = assignment[slotIdx];
    slot.cells.forEach(function (cellIndex, pos) {
      cases[cellIndex].value = word[pos];
    });
  });

  cases.forEach(function (cell, idx) {
    if (cell.type !== enums.CaseType.Description) return;

    var rightSlotIdx = findSlotStartingAt(slots, idx + 1, 'H');
    var belowSlotIdx = findSlotStartingAt(slots, idx + nbLines, 'V');

    var attached = [];
    if (rightSlotIdx !== -1) attached.push({ direction: ARROW_RIGHT, word: assignment[rightSlotIdx] });
    if (belowSlotIdx !== -1) attached.push({ direction: ARROW_BOTTOM, word: assignment[belowSlotIdx] });

    cell.nbDesc = attached.length;
    cell.nbLines = attached.length;
    cell.desc = [];
    cell.arrow = [];
    attached.forEach(function (a) {
      var defs = dictionary.definitionsByWord.get(a.word) || [];
      cell.desc.push(defs.length > 0 ? defs[0] : '');
      cell.arrow.push(a.direction);
    });
  });

  return { nbLines: nbLines, nbColumns: nbColumns, nbWords: slots.length, cases: cases };
}

module.exports = { exportGrid: exportGrid };
