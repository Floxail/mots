// grid_generator/slots.js
var enums = require('../game_files/enums');

function scanAxis(types, nbLines, nbColumns, axis) {
  var step = axis === 'H' ? 1 : nbLines;
  var outerCount = axis === 'H' ? nbColumns : nbLines;
  var innerCount = axis === 'H' ? nbLines : nbColumns;
  var found = [];

  for (var outer = 0; outer < outerCount; outer++) {
    var base = axis === 'H' ? outer * nbLines : outer;
    var i = 0;
    while (i < innerCount) {
      if (types[base + i * step] === enums.CaseType.Letter) {
        var cells = [];
        while (i < innerCount && types[base + i * step] === enums.CaseType.Letter) {
          cells.push(base + i * step);
          i++;
        }
        if (cells.length >= 2) {
          found.push({ axis: axis, cells: cells, length: cells.length, crossings: [] });
        }
      } else {
        i++;
      }
    }
  }
  return found;
}

function deriveSlots(skeleton) {
  var horizontal = scanAxis(skeleton.types, skeleton.nbLines, skeleton.nbColumns, 'H');
  var vertical = scanAxis(skeleton.types, skeleton.nbLines, skeleton.nbColumns, 'V');
  var slots = horizontal.concat(vertical);

  slots.forEach(function (slot, slotIdx) {
    slot.cells.forEach(function (cellIndex, pos) {
      slots.forEach(function (other, otherIdx) {
        if (other.axis === slot.axis) return;
        var otherPos = other.cells.indexOf(cellIndex);
        if (otherPos !== -1) {
          slot.crossings.push({ slotIndex: otherIdx, ownPos: pos, otherPos: otherPos });
        }
      });
    });
  });

  return slots;
}

module.exports = { deriveSlots: deriveSlots };
