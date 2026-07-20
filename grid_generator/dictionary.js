function buildDictionary(entries) {
  var byLength = new Map();
  var crossIndex = new Map();
  var definitionsByWord = new Map();

  entries.forEach(function (entry) {
    var word = entry.word;
    var len = word.length;

    if (!byLength.has(len)) byLength.set(len, []);
    byLength.get(len).push(word);

    if (!crossIndex.has(len)) crossIndex.set(len, new Map());
    var posMap = crossIndex.get(len);
    for (var i = 0; i < len; i++) {
      if (!posMap.has(i)) posMap.set(i, new Map());
      var letterMap = posMap.get(i);
      var letter = word[i];
      if (!letterMap.has(letter)) letterMap.set(letter, new Set());
      letterMap.get(letter).add(word);
    }

    if (!definitionsByWord.has(word)) definitionsByWord.set(word, []);
    entry.definitions.forEach(function (d) {
      definitionsByWord.get(word).push(d);
    });
  });

  function candidatesFor(length, constraints, excluded) {
    var pool = byLength.get(length) || [];

    if (constraints.length === 0) {
      return pool.filter(function (w) { return !excluded.has(w); });
    }

    var posMap = crossIndex.get(length);
    if (!posMap) return [];

    var sets = constraints.map(function (c) {
      var letterMap = posMap.get(c.pos);
      if (!letterMap) return new Set();
      return letterMap.get(c.letter) || new Set();
    });

    sets.sort(function (a, b) { return a.size - b.size; });

    var result = [];
    sets[0].forEach(function (w) {
      if (excluded.has(w)) return;
      for (var i = 1; i < sets.length; i++) {
        if (!sets[i].has(w)) return;
      }
      result.push(w);
    });
    return result;
  }

  return {
    byLength: byLength,
    crossIndex: crossIndex,
    definitionsByWord: definitionsByWord,
    candidatesFor: candidatesFor
  };
}

module.exports = { buildDictionary: buildDictionary };
