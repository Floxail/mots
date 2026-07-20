var enums = require('../game_files/enums');

function measureSegments(grid, axis) {
  var nbLines = grid.nbLines;
  var step = axis === 'H' ? 1 : nbLines;
  var outerCount = axis === 'H' ? grid.nbColumns : nbLines;
  var innerCount = axis === 'H' ? nbLines : grid.nbColumns;
  var lengths = [];

  for (var outer = 0; outer < outerCount; outer++) {
    var base = axis === 'H' ? outer * nbLines : outer;
    var runLength = 0;
    for (var inner = 0; inner < innerCount; inner++) {
      var cell = grid.cases[base + inner * step];
      if (cell && cell.type === enums.CaseType.Letter) {
        runLength++;
      } else {
        if (runLength > 0) lengths.push(runLength);
        runLength = 0;
      }
    }
    if (runLength > 0) lengths.push(runLength);
  }

  return lengths;
}

function computeStats(grids) {
  var totalCells = 0;
  var descriptionCells = 0;
  var oneDefCount = 0;
  var twoDefCount = 0;
  var segmentLengths = [];

  grids.forEach(function (grid) {
    totalCells += grid.cases.length;
    grid.cases.forEach(function (cell) {
      if (cell.type === enums.CaseType.Description) {
        descriptionCells++;
        if (cell.nbDesc === 2) twoDefCount++;
        else oneDefCount++;
      }
    });
    segmentLengths = segmentLengths.concat(measureSegments(grid, 'H'));
    segmentLengths = segmentLengths.concat(measureSegments(grid, 'V'));
  });

  var segmentLengthCounts = {};
  segmentLengths.forEach(function (len) {
    segmentLengthCounts[len] = (segmentLengthCounts[len] || 0) + 1;
  });

  return {
    descriptionDensity: totalCells > 0 ? descriptionCells / totalCells : 0,
    twoDefRatio: (oneDefCount + twoDefCount) > 0 ? twoDefCount / (oneDefCount + twoDefCount) : 0,
    segmentLengthCounts: segmentLengthCounts
  };
}

module.exports = { computeStats: computeStats, measureSegments: measureSegments };
