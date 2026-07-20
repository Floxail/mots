// scripts/lib/scanGsoGrids.js
var https = require('https');

var DEFAULT_RANGES = [[1292, 2117], [2401, 2600]];

function checkGrid(n) {
  return new Promise(function (resolve) {
    var req = https.get(
      'https://www.rcijeux.fr/drupal_game/gso/mfleches/grids/' + n + '.mfj',
      function (res) { res.resume(); resolve({ n: n, ok: res.statusCode === 200 }); }
    );
    req.on('error', function () { resolve({ n: n, ok: false }); });
    req.setTimeout(3000, function () { req.destroy(); resolve({ n: n, ok: false }); });
  });
}

function scanRange(from, to, concurrency) {
  concurrency = concurrency || 10;
  var results = [];

  function nextBatch(i) {
    if (i > to) return Promise.resolve(results);
    var batch = [];
    for (var j = i; j < Math.min(i + concurrency, to + 1); j++) batch.push(checkGrid(j));
    return Promise.all(batch).then(function (res) {
      res.forEach(function (r) { if (r.ok) results.push(r.n); });
      return nextBatch(i + concurrency);
    });
  }

  return nextBatch(from);
}

function scanAvailableGrids(ranges) {
  ranges = ranges || DEFAULT_RANGES;
  return Promise.all(ranges.map(function (r) { return scanRange(r[0], r[1]); }))
    .then(function (lists) { return lists.reduce(function (all, l) { return all.concat(l); }, []); });
}

module.exports = {
  scanAvailableGrids: scanAvailableGrids,
  scanRange: scanRange,
  checkGrid: checkGrid,
  DEFAULT_RANGES: DEFAULT_RANGES
};

if (require.main === module) {
  scanAvailableGrids().then(function (ids) {
    console.log('Grilles disponibles: ' + ids.length);
    console.log(ids.join(','));
  });
}
