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
