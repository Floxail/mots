// scripts/scrape-dico.js
var fs = require('fs');
var path = require('path');
var GridManager = require('../game_files/gridManager');
var scanGsoGrids = require('./lib/scanGsoGrids');
var extractWords = require('../grid_generator/extractWords');

function processOne(id) {
  return new Promise(function (resolve) {
    var gm = new GridManager();
    gm.retreiveAndParseGrid(id, function (grid) {
      resolve(grid ? extractWords.extractWordDefPairs(grid) : []);
    });
  });
}

function scrapeAll() {
  return scanGsoGrids.scanAvailableGrids().then(function (ids) {
    console.log('Telechargement de ' + ids.length + ' grilles...');
    var wordMap = new Map();

    return ids.reduce(function (chain, id) {
      return chain.then(function () {
        return processOne(id).then(function (pairs) {
          pairs.forEach(function (pair) {
            if (!wordMap.has(pair.word)) wordMap.set(pair.word, new Set());
            wordMap.get(pair.word).add(pair.definition);
          });
        });
      });
    }, Promise.resolve()).then(function () {
      var entries = [];
      wordMap.forEach(function (defs, word) {
        entries.push({ word: word, definitions: Array.from(defs) });
      });
      return entries;
    });
  });
}

if (require.main === module) {
  scrapeAll().then(function (entries) {
    var dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'dico.json'), JSON.stringify(entries, null, 2));
    console.log(entries.length + ' mots ecrits dans data/dico.json');
  }).catch(function (err) {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { scrapeAll: scrapeAll };
