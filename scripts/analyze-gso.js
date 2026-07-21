// scripts/analyze-gso.js
var fs = require('fs');
var path = require('path');
var GridManager = require('../game_files/gridManager');
var scanGsoGrids = require('./lib/scanGsoGrids');
var statsLib = require('../grid_generator/stats');

function fetchOne(id) {
  return new Promise(function (resolve) {
    var gm = new GridManager();
    gm.retreiveAndParseGrid(id, function (grid) { resolve(grid); });
  });
}

function analyzeAll() {
  return scanGsoGrids.scanAvailableGrids().then(function (ids) {
    console.log('Analyse de ' + ids.length + ' grilles...');

    return ids.reduce(function (chain, id) {
      return chain.then(function (grids) {
        return fetchOne(id).then(function (grid) {
          if (grid) grids.push(grid);
          return grids;
        });
      });
    }, Promise.resolve([])).then(function (grids) {
      return statsLib.computeStats(grids);
    });
  });
}

if (require.main === module) {
  analyzeAll().then(function (stats) {
    var dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'gso-stats.json'), JSON.stringify(stats, null, 2));
    console.log('Stats ecrites dans data/gso-stats.json:', stats.descriptionDensity, stats.twoDefRatio);
  }).catch(function (err) {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { analyzeAll: analyzeAll };
