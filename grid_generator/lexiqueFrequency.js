var extractWords = require('./extractWords');

// Lexique4.tsv (lexique.org) - real French usage frequency per word form.
// Column index 9 is "10_FreqMot" (frequency per million occurrences), the
// same signal scripts/scrape-fsolver.js::buildCandidateListFromLexique
// already uses to curate data/dico.json's word list. This builds a full
// word -> frequency lookup instead, for sorting a dictionary's candidate
// pools at runtime (grid_generator/dictionary.js's buildDictionary).
function buildFrequencyMap(rawText) {
  var freqMap = new Map();
  var lines = rawText.split('\n');

  for (var i = 1; i < lines.length; i++) {
    var cols = lines[i].split('\t');
    if (cols.length < 15) continue;

    var word = extractWords.normalizeWord(cols[0]);
    var freq = parseFloat(cols[9]) || 0;
    if (freqMap.has(word) && freqMap.get(word) >= freq) continue;
    freqMap.set(word, freq);
  }

  return freqMap;
}

module.exports = { buildFrequencyMap: buildFrequencyMap };
