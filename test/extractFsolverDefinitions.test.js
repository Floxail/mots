var test = require('node:test');
var assert = require('node:assert');
var extractFsolverDefinitions = require('../grid_generator/extractFsolverDefinitions');

test('extracts definitions from the id="definitions" block', function () {
  var html = '<div class="res_def_bdd p-3" id="definitions"> <p> <div class=\'h3\'> Les definitions du mot <span>CHAT</span> </div> <ul class="ml-3"> <li class=\'ml-n4\'> <span itemprop=\'acceptedAnswer\'> <span class=\'h5 text-dark\'><span itemprop=\'text\'>PETIT CARNIVORE</span></span> </span> </li> <li class=\'ml-n4\'> <span itemprop=\'acceptedAnswer\'> <span class=\'h5 text-dark\'><span itemprop=\'text\'>GREFFIER D\'ANTAN</span></span> </span> </li> </ul> </p></div> <div id=\'dialog\'>';
  var defs = extractFsolverDefinitions.extractDefinitions(html);
  assert.deepStrictEqual(defs, ['PETIT CARNIVORE', 'GREFFIER D\'ANTAN']);
});

test('returns an empty array when the word has no definitions', function () {
  var html = '<div class="res_wikt"><div id="res_syn">no definitions block here</div></div>';
  var defs = extractFsolverDefinitions.extractDefinitions(html);
  assert.deepStrictEqual(defs, []);
});

test('stops at the closing </div></div> and does not leak into the next section', function () {
  var html = '<div class="res_def_bdd p-3" id="definitions"><ul><li><span itemprop=\'text\'>BONNE DEF</span></li></ul></div></div><div id=\'dialog\'><span itemprop=\'text\'>PAS UNE DEFINITION</span></div>';
  var defs = extractFsolverDefinitions.extractDefinitions(html);
  assert.deepStrictEqual(defs, ['BONNE DEF']);
});

test('hasNoResult detects a page with zero definitions found', function () {
  var htmlWithZero = '<span itemprop=\'answerCount\'>0</span> definitions';
  assert.strictEqual(extractFsolverDefinitions.extractDefinitions(htmlWithZero).length, 0);
});
