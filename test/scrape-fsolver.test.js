var test = require('node:test');
var assert = require('node:assert');
var scrapeFsolver = require('../scripts/scrape-fsolver');

test('buildCandidateList filters non-alpha, out-of-range lengths, dedupes, and skips already-known words', function () {
  var raw = 'chat\nchien\nabaisse-langue\nabaissé\na\nsuperextraordinairement\nCHAT\nchien\n';
  var candidates = scrapeFsolver.buildCandidateList(raw, 100, new Set(['CHIEN']));
  assert.ok(candidates.indexOf('CHAT') !== -1);
  assert.strictEqual(candidates.indexOf('CHIEN'), -1);
  assert.strictEqual(candidates.indexOf('A'), -1);
  assert.strictEqual(candidates.filter(function (w) { return w === 'CHAT'; }).length, 1);
});

test('buildCandidateList caps the number of words taken per length bucket', function () {
  var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var words = [];
  for (var i = 0; i < 26; i++) {
    for (var j = 0; j < 2; j++) words.push('AB' + letters[i] + letters[j]);
  }
  var raw = words.join('\n');
  var candidates = scrapeFsolver.buildCandidateList(raw, 14, new Set());
  var lengthFour = candidates.filter(function (w) { return w.length === 4; });
  assert.ok(lengthFour.length <= 14);
});

function lexiqueRow(mot, freqMot, nbLettres) {
  var cols = new Array(15).fill('');
  cols[0] = mot;
  cols[9] = String(freqMot);
  cols[14] = String(nbLettres);
  return cols.join('\t');
}

test('buildCandidateListFromLexique picks the highest-frequency words per length, ignoring non-alpha/out-of-range rows', function () {
  var header = '1_Mot\t...';
  var rows = [
    lexiqueRow('chat', 50, 4),
    lexiqueRow('chic', 5, 4),
    lexiqueRow("n'", 9999, 2),
    lexiqueRow('abaisse-langue', 20, 14),
    lexiqueRow('bois', 10, 4)
  ];
  var raw = [header].concat(rows).join('\n');

  var candidates = scrapeFsolver.buildCandidateListFromLexique(raw, 1, new Set());
  var lengthFour = candidates.filter(function (w) { return w.length === 4; });
  assert.deepStrictEqual(lengthFour, ['CHAT']);
});

test('buildCandidateListFromLexique keeps the max frequency seen when a word appears on multiple rows', function () {
  var header = '1_Mot\t...';
  var rows = [
    lexiqueRow('avance', 3, 6),
    lexiqueRow('avance', 80, 6)
  ];
  var raw = [header].concat(rows).join('\n');

  var candidates = scrapeFsolver.buildCandidateListFromLexique(raw, 1, new Set());
  assert.deepStrictEqual(candidates, ['AVANCE']);
});
