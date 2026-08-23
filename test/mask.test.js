var test = require('node:test');
var assert = require('node:assert');
var mask = require('../grid_generator/mask');

function L() { return { kind: 'L' }; }
function D() { return { kind: 'D', arrows: Array.prototype.slice.call(arguments) }; }
function M(nbLines, nbColumns, cells) { return { cells: cells, nbLines: nbLines, nbColumns: nbColumns }; }

test('deriveWords: straight R arrow walks right until non-letter', function () {
  var m = M(3, 1, [D('R'), L(), L()]);
  var words = mask.deriveWords(m);
  assert.strictEqual(words.length, 1);
  assert.deepStrictEqual(words[0], { axis: 'H', cells: [1, 2], defCell: 0, arrowIndex: 0, arrow: 'R' });
});

test('deriveWords: bent RB starts right of the def and runs down', function () {
  // 2x2: D at (0,0), everything else Letter
  var m = M(2, 2, [D('RB'), L(), L(), L()]);
  var words = mask.deriveWords(m);
  assert.strictEqual(words[0].axis, 'V');
  assert.deepStrictEqual(words[0].cells, [1, 3]);
});

test('deriveWords: bent BR starts below the def and runs right', function () {
  var m = M(2, 2, [D('BR'), L(), L(), L()]);
  assert.strictEqual(mask.deriveWords(m)[0].axis, 'H');
  assert.deepStrictEqual(mask.deriveWords(m)[0].cells, [2, 3]);
});

test('deriveWords: B arrow runs down from below the def', function () {
  var m = M(2, 2, [D('B'), L(), L(), L()]);
  assert.strictEqual(mask.deriveWords(m)[0].axis, 'V');
  assert.deepStrictEqual(mask.deriveWords(m)[0].cells, [2]);
});

test('deriveWords: arrow pointing off-grid yields an empty word', function () {
  var m = M(1, 1, [D('R')]);
  assert.deepStrictEqual(mask.deriveWords(m)[0].cells, []);
});

test('deriveWords: word stops at a Description cell', function () {
  var m = M(4, 1, [D('R'), L(), D('R'), L()]);
  var words = mask.deriveWords(m);
  assert.deepStrictEqual(words[0].cells, [1]);
  assert.deepStrictEqual(words[1].cells, [3]);
});

test('deriveWords: horizontal walk never wraps to the next row', function () {
  // D at end of row 0 pointing R -> off-grid; letters on row 1 must not be picked up
  var m = M(2, 2, [L(), D('R'), L(), L()]);
  var words = mask.deriveWords(m);
  assert.deepStrictEqual(words[0].cells, []);
});

test('deriveWords: a double def cell yields two words in arrow order', function () {
  var m = M(2, 2, [D('R', 'B'), L(), L(), L()]);
  var words = mask.deriveWords(m);
  assert.strictEqual(words.length, 2);
  assert.strictEqual(words[0].arrowIndex, 0);
  assert.strictEqual(words[0].arrow, 'R');
  assert.strictEqual(words[1].arrow, 'B');
});
