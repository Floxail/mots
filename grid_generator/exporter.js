var enums = require('../game_files/enums');
var Case = require('../game_files/case');

var ARROW_RIGHT = enums.ArrowDirections.Right;
var ARROW_BOTTOM = enums.ArrowDirections.Bottom;

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
