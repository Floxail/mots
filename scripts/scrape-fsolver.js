var fs = require('fs');
var path = require('path');
var https = require('https');
var extractWords = require('../grid_generator/extractWords');
var extractFsolverDefinitions = require('../grid_generator/extractFsolverDefinitions');

var WORDLIST_URL = 'https://raw.githubusercontent.com/chrplr/openlexicon/master/datasets-info/Liste-de-mots-francais-Gutenberg/liste.de.mots.francais.frgut.txt';
var DATA_DIR = path.join(__dirname, '..', 'data');
var WORDLIST_CACHE = path.join(DATA_DIR, 'wordlist-raw.txt');
var DICO_PATH = path.join(DATA_DIR, 'dico.json');
var MIN_LENGTH = 2;
var MAX_LENGTH = 15;
var REQUEST_DELAY_MS = 1500;
var RATE_LIMIT_BACKOFF_MS = 10000;

function httpsGet(url) {
  return new Promise(function (resolve) {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
      });
    }).on('error', function (e) {
      resolve({ status: 0, body: '', error: e.message });
    });
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function fetchWordlist() {
  if (fs.existsSync(WORDLIST_CACHE)) {
    return Promise.resolve(fs.readFileSync(WORDLIST_CACHE, 'utf8'));
  }
  return httpsGet(WORDLIST_URL).then(function (r) {
    if (r.status !== 200) throw new Error('Impossible de telecharger la wordlist (HTTP ' + r.status + ')');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(WORDLIST_CACHE, r.body);
    return r.body;
  });
}

function shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function buildCandidateList(rawText, budget, alreadyKnown) {
  var byLength = {};
  var seen = new Set();

  rawText.split('\n').forEach(function (line) {
    var word = extractWords.normalizeWord(line.trim());
    if (!/^[A-Z]+$/.test(word)) return;
    if (word.length < MIN_LENGTH || word.length > MAX_LENGTH) return;
    if (seen.has(word) || alreadyKnown.has(word)) return;
    seen.add(word);
    if (!byLength[word.length]) byLength[word.length] = [];
    byLength[word.length].push(word);
  });

  var lengths = Object.keys(byLength).map(Number);
  var capPerLength = Math.ceil(budget / lengths.length);
  var selected = [];
  lengths.forEach(function (len) {
    var bucket = shuffle(byLength[len]).slice(0, capPerLength);
    selected = selected.concat(bucket);
  });

  return selected;
}

function loadExistingDico() {
  if (!fs.existsSync(DICO_PATH)) return new Map();
  var entries = JSON.parse(fs.readFileSync(DICO_PATH, 'utf8'));
  var map = new Map();
  entries.forEach(function (e) { map.set(e.word, new Set(e.definitions)); });
  return map;
}

function saveDico(map) {
  var entries = [];
  map.forEach(function (defs, word) { entries.push({ word: word, definitions: Array.from(defs) }); });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DICO_PATH, JSON.stringify(entries, null, 2));
}

function scrapeWord(word) {
  return httpsGet('https://www.fsolver.fr/mots-fleches/' + word).then(function (r) {
    if (r.status === 429) {
      return sleep(RATE_LIMIT_BACKOFF_MS).then(function () {
        return httpsGet('https://www.fsolver.fr/mots-fleches/' + word);
      });
    }
    return r;
  }).then(function (r) {
    if (r.status !== 200) return [];
    return extractFsolverDefinitions.extractDefinitions(r.body);
  });
}

function scrapeAll(words, dico, onProgress) {
  return words.reduce(function (chain, word, idx) {
    return chain.then(function () {
      return scrapeWord(word).then(function (defs) {
        if (defs.length > 0) {
          if (!dico.has(word)) dico.set(word, new Set());
          defs.forEach(function (d) { dico.get(word).add(d); });
        }
        if (onProgress) onProgress(word, defs.length, idx + 1, words.length);
        return sleep(REQUEST_DELAY_MS);
      });
    });
  }, Promise.resolve());
}

if (require.main === module) {
  var budget = parseInt(process.argv[2], 10) || 500;

  fetchWordlist().then(function (rawText) {
    var dico = loadExistingDico();
    var alreadyKnown = new Set(dico.keys());
    var candidates = buildCandidateList(rawText, budget, alreadyKnown);
    console.log(candidates.length + ' mots a scraper sur fsolver.fr (budget demande: ' + budget + ')...');

    return scrapeAll(candidates, dico, function (word, count, idx, total) {
      console.log('[' + idx + '/' + total + '] ' + word + ' -> ' + count + ' definitions');
    }).then(function () {
      saveDico(dico);
      console.log(dico.size + ' mots au total dans data/dico.json');
    });
  }).catch(function (err) {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  buildCandidateList: buildCandidateList,
  scrapeAll: scrapeAll,
  scrapeWord: scrapeWord
};
