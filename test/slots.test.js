// test/slots.test.js
var test = require('node:test');
var assert = require('node:assert');
var enums = require('../game_files/enums');
var slots = require('../grid_generator/slots');

test('deriveSlots finds horizontal and vertical runs of length >= 2 and links their crossing', function () {
  var D = enums.CaseType.Description, L = enums.CaseType.Letter;
  // 3 wide x 2 tall:
  // row0: D L L
  // row1: L D L
  var skeleton = { nbLines: 3, nbColumns: 2, types: [D, L, L, L, D, L] };

  var result = slots.deriveSlots(skeleton);

  var horizontal = result.filter(function (s) { return s.axis === 'H'; });
  var vertical = result.filter(function (s) { return s.axis === 'V'; });

  assert.strictEqual(horizontal.length, 1);
  assert.deepStrictEqual(horizontal[0].cells, [1, 2]);

  assert.strictEqual(vertical.length, 1);
  assert.deepStrictEqual(vertical[0].cells, [2, 5]);

  assert.strictEqual(horizontal[0].crossings.length, 1);
  assert.strictEqual(horizontal[0].crossings[0].ownPos, 1);
  assert.strictEqual(horizontal[0].crossings[0].otherPos, 0);
});
