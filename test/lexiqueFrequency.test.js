var test = require('node:test');
var assert = require('node:assert');
var lexiqueFrequency = require('../grid_generator/lexiqueFrequency');

var HEADER = '1_Mot\t2_Phono\t3_Phono_IPA\t4_Lemme\t5_Cgram\t6_CgramOrtho\t7_Genre\t8_Nombre\t9_InfoVER\t10_FreqMot\t11_FreqOrtho\t12_FreqLemme\t13_CDOrtho\t14_IsLem\t15_NbLettres';

test('buildFrequencyMap reads word and frequency (column index 9) from each row, skipping the header', function () {
  var rawText = [
    HEADER,
    'chat\tS\tS\tchat\tNOM\tNOM\tm\ts\t\t12.34\t0\t0\t0\t1\t4'
  ].join('\n');

  var freqMap = lexiqueFrequency.buildFrequencyMap(rawText);
  assert.strictEqual(freqMap.get('CHAT'), 12.34);
});

test('buildFrequencyMap normalizes accents and case to match dico.json word format', function () {
  var rawText = [
    HEADER,
    'disproportionnées\tx\tx\tx\tVER\tVER\tf\tp\t\t0.041\t0\t0\t0\t0\t17'
  ].join('\n');

  var freqMap = lexiqueFrequency.buildFrequencyMap(rawText);
  assert.strictEqual(freqMap.get('DISPROPORTIONNEES'), 0.041);
});

test('buildFrequencyMap keeps the highest frequency when the same word form appears on multiple rows', function () {
  var rawText = [
    HEADER,
    'chat\tx\tx\tx\tNOM\tNOM\tm\ts\t\t1\t0\t0\t0\t1\t4',
    'chat\tx\tx\tx\tNOM\tNOM\tm\ts\t\t99\t0\t0\t0\t1\t4',
    'chat\tx\tx\tx\tNOM\tNOM\tm\ts\t\t5\t0\t0\t0\t1\t4'
  ].join('\n');

  var freqMap = lexiqueFrequency.buildFrequencyMap(rawText);
  assert.strictEqual(freqMap.get('CHAT'), 99);
});

test('buildFrequencyMap skips malformed rows (too few columns) instead of throwing', function () {
  var rawText = [
    HEADER,
    'trop\tcourt',
    'chat\tx\tx\tx\tNOM\tNOM\tm\ts\t\t7\t0\t0\t0\t1\t4'
  ].join('\n');

  var freqMap = lexiqueFrequency.buildFrequencyMap(rawText);
  assert.strictEqual(freqMap.size, 1);
  assert.strictEqual(freqMap.get('CHAT'), 7);
});

test('buildFrequencyMap treats an unparseable frequency column as 0', function () {
  var rawText = [
    HEADER,
    'chat\tx\tx\tx\tNOM\tNOM\tm\ts\t\t\t0\t0\t0\t1\t4'
  ].join('\n');

  var freqMap = lexiqueFrequency.buildFrequencyMap(rawText);
  assert.strictEqual(freqMap.get('CHAT'), 0);
});
