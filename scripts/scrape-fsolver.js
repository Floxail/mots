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

// The Gutenberg wordlist is dominated by rare conjugated verb forms at long
// lengths (e.g. "REENSEMENCEREZ"), which fsolver rarely has definitions for.
// This curated list of real, common nouns/adjectives fills the 10-15 letter
// range that the random sampling leaves nearly empty.
var CURATED_LONG_WORDS = [
  'ANNIVERSAIRE', 'INTERNATIONAL', 'EXTRAORDINAIRE', 'RESPONSABILITE', 'CARACTERISTIQUE',
  'ENVIRONNEMENT', 'ORGANISATION', 'DEVELOPPEMENT', 'COMMUNICATION', 'INTELLIGENCE',
  'ARCHITECTURE', 'BIBLIOTHEQUE', 'CONCENTRATION', 'DEMONSTRATION', 'EXPLORATION',
  'GENERATION', 'HABITATION', 'IMAGINATION', 'INSTITUTION', 'INVESTIGATION',
  'LEGISLATION', 'NAVIGATION', 'OBSERVATION', 'PARTICIPATION', 'PRESENTATION',
  'PRODUCTION', 'PROTECTION', 'PUBLICATION', 'REALISATION', 'RECONNAISSANCE',
  'REVOLUTION', 'TRANSFORMATION', 'ADMINISTRATION', 'ALIMENTATION', 'AMELIORATION',
  'APPRECIATION', 'ASSOCIATION', 'CELEBRATION', 'CIVILISATION', 'COLLABORATION',
  'COMPETITION', 'COMPOSITION', 'CONSTRUCTION', 'CONSULTATION', 'CONTRIBUTION',
  'CONVERSATION', 'DECLARATION', 'DEFINITION', 'DELEGATION', 'DEMONSTRATEUR',
  'DESTINATION', 'DISTRIBUTION', 'DOCUMENTATION', 'ELIMINATION', 'EXPEDITION',
  'EXPERIMENTATION', 'EXPLICATION', 'EXPORTATION', 'FEDERATION', 'FONDATION',
  'FORMULATION', 'FRUSTRATION', 'GENERALISATION', 'HABITUDE', 'IDENTIFICATION',
  'ILLUSTRATION', 'IMMIGRATION', 'IMPORTATION', 'IMPRESSION', 'INDICATION',
  'INFORMATION', 'INSPIRATION', 'INSTALLATION', 'INSTRUCTION', 'INTEGRATION',
  'INTERPRETATION', 'INTERVENTION', 'INTRODUCTION', 'INVITATION', 'LIBERATION',
  'LOCALISATION', 'MANIFESTATION', 'MEDITATION', 'MODIFICATION', 'MOTIVATION',
  'MULTIPLICATION', 'MUNICIPALITE', 'NEGOCIATION', 'NOTIFICATION', 'OCCUPATION',
  'OPERATION', 'OPPOSITION', 'ORIENTATION', 'PARTICIPANT', 'PERCEPTION',
  'PERMISSION', 'PERSONNALITE', 'PERSPECTIVE', 'PLANIFICATION', 'POPULATION',
  'POSSIBILITE', 'PRECAUTION', 'PREDICTION', 'PREPARATION', 'PRESERVATION',
  'PREVENTION', 'PROBABILITE', 'PROCLAMATION', 'PROGRAMMATION', 'PROLONGATION',
  'PROPORTION', 'PROPOSITION', 'PROSPERITE', 'PROVOCATION', 'PSYCHOLOGIE',
  'PUNITION', 'QUALIFICATION', 'REACTION', 'RECOMMANDATION', 'RECONSTRUCTION',
  'REDUCTION', 'REFLEXION', 'REGENERATION', 'REGLEMENTATION', 'RELATION',
  'REPETITION', 'REPRESENTATION', 'REPRODUCTION', 'RESERVATION', 'RESIGNATION',
  'RESOLUTION', 'RESTAURATION', 'RESTRICTION', 'RETRIBUTION', 'REUNIFICATION',
  'REVELATION', 'SATISFACTION', 'SELECTION', 'SEPARATION', 'SIGNIFICATION',
  'SIMPLIFICATION', 'SITUATION', 'SOLUTION', 'SPECIALISATION', 'SPECIFICATION',
  'SPECULATION', 'STABILISATION', 'STIMULATION', 'SUBSTITUTION', 'SUGGESTION',
  'SUPERSTITION', 'SUPPOSITION', 'SUPPRESSION', 'SURVEILLANCE', 'TELECOMMUNICATION',
  'TENTATION', 'TERMINAISON', 'TOLERANCE', 'TRADITION', 'TRANSACTION',
  'TRANSMISSION', 'TRANSPORTATION', 'VACCINATION', 'VALORISATION', 'VARIATION',
  'VEGETATION', 'VERIFICATION', 'VIBRATION', 'VIOLATION', 'VISUALISATION',
  'RESPONSABILITES', 'TRANSFORMATIONS', 'ADMINISTRATIONS', 'INTERPRETATIONS',
  'RECOMMANDATIONS', 'REPRESENTATIONS', 'IDENTIFICATIONS', 'MULTIPLICATIONS',
  'SPECIALISATIONS', 'GENERALISATIONS', 'SIMPLIFICATIONS', 'RECONSTRUCTIONS'
];

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

function collectByLength(lines, seen) {
  var byLength = {};
  lines.forEach(function (raw) {
    var word = extractWords.normalizeWord(raw);
    if (!/^[A-Z]+$/.test(word)) return;
    if (word.length < MIN_LENGTH || word.length > MAX_LENGTH) return;
    if (seen.has(word)) return;
    seen.add(word);
    if (!byLength[word.length]) byLength[word.length] = [];
    byLength[word.length].push(word);
  });
  return byLength;
}

function buildCandidateList(rawText, budget, alreadyKnown, curatedWords) {
  var seen = new Set(alreadyKnown);
  var curatedByLength = collectByLength(curatedWords || [], seen);
  var wordlistByLength = collectByLength(rawText.split('\n'), seen);

  // Longest first: those buckets are the scarcest (needed for a 15x15 grid's
  // longest slots) and the least likely to be reached if a run is stopped
  // partway through or interrupted by rate-limiting.
  var lengths = Object.keys(Object.assign({}, curatedByLength, wordlistByLength))
    .map(Number)
    .sort(function (a, b) { return b - a; });
  var capPerLength = Math.ceil(budget / lengths.length);
  var selected = [];
  lengths.forEach(function (len) {
    var curated = curatedByLength[len] || [];
    var remaining = Math.max(0, capPerLength - curated.length);
    var fromWordlist = shuffle(wordlistByLength[len] || []).slice(0, remaining);
    selected = selected.concat(curated, fromWordlist);
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

var SAVE_EVERY_N_WORDS = 20;

if (require.main === module) {
  var budget = parseInt(process.argv[2], 10) || 500;

  fetchWordlist().then(function (rawText) {
    var dico = loadExistingDico();
    var alreadyKnown = new Set(dico.keys());
    var candidates = buildCandidateList(rawText, budget, alreadyKnown, CURATED_LONG_WORDS);
    console.log(candidates.length + ' mots a scraper sur fsolver.fr (budget demande: ' + budget + ')...');

    process.on('SIGINT', function () {
      console.log('\nInterrompu, sauvegarde de ' + dico.size + ' mots avant de quitter...');
      saveDico(dico);
      process.exit(0);
    });

    return scrapeAll(candidates, dico, function (word, count, idx, total) {
      console.log('[' + idx + '/' + total + '] ' + word + ' -> ' + count + ' definitions');
      if (idx % SAVE_EVERY_N_WORDS === 0) saveDico(dico);
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
