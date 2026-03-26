var https    = require('https'),
    vm      = require('vm'),
    fs      = require('fs'),
    path    = require('path'),
    config  = require('../conf.json').GRID_PROVIDER,
    enums   = require('./enums'),
    Case    = require('./case');

// Persist downloaded grids to disk so they survive server restarts
// and work offline for tests
var CACHE_DIR = path.join(__dirname, '..', 'cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

var enumCaseParser = {
  InARow: 1,
  Horizontal: 2,
  Vertical: 3
};

var enumArrow = {
  Right: 0,
  RightBottom: 1,
  Bottom: 2,
  BottomRight: 3
};

// Module-level cache: resolved grid number → raw .mfj text
// Shared across all GridManager instances to avoid re-downloading the same grid
var _rawGridCache = {};


function GridManager() {
  // Instance state (not module-level variables)
  this._grid           = null;
  this._wordsPoints    = null;
  this._theme          = null;
  this._nbLetters      = 0;
  this._lastSearchCase = 0;
  this._maxPoints      = 0;
  this._gridInfos      = {
    provider: '',
    id:       0,
    level:    0,
    nbWords:  0
  };
}

function getNextCase(grid, kindMove, caseType, lastCase) {
  var iterator = 0;

  if (lastCase) {
    iterator = lastCase.pos;
    if ((kindMove == enumCaseParser.InARow) || (kindMove == enumCaseParser.Horizontal))
      iterator++;
    else if (kindMove == enumCaseParser.Vertical)
      iterator += grid.nbLines;
  }

  if (iterator >= grid.cases.length)
    return (null);

  if (caseType != grid.cases[iterator].type)
    return (getNextCase(grid, kindMove, caseType, grid.cases[iterator]));

  return (grid.cases[iterator]);
}

function insertDescription(grid, desc) {
  var currentCase = getNextCase(grid, enumCaseParser.InARow, enums.CaseType.Description),
      assigned = false;

  while (currentCase !== null && !assigned) {
    assigned = currentCase.setDescription(desc);
    currentCase = getNextCase(grid, enumCaseParser.InARow, enums.CaseType.Description, currentCase);
  }
}

function getCaseType(Char) {
  if (Char == 'z')
    return (enums.CaseType.Empty);
    else if ((Char >= 'A') && (Char <= 'Z'))
    return (enums.CaseType.Letter);
  else
    return (enums.CaseType.Description);
}

function onGetGridError(cb, errorMessage) {
  console.error('\t[ERROR]: Cannot retreive grid...');
  console.error('\t[ERROR]: ' + errorMessage);
  cb(null);
}

function parseGrid(self, callback, serverText) {
  var sandbox = {},
      data,
      currentCase = 0,
      type,
      grid = {
        nbLines: 0,
        nbColumns: 0,
        nbWords: 0,
        cases: []
      };

  try {
    vm.runInNewContext(serverText, sandbox);
  } catch (e) {
    onGetGridError(callback, 'Failed to parse grid file: ' + e.message);
    return;
  }

  data = sandbox.gamedata;
  if (!data || !data.grille) {
    onGetGridError(callback, 'Invalid grid format: no gamedata found');
    return;
  }

  grid.nbLines   = data.nbcaseslargeur;
  grid.nbColumns = data.nbcaseshauteur;
  grid.nbWords   = data.definitions.length;

  self._wordsPoints       = data.definitions;
  self._gridInfos.nbWords = data.definitions.length;
  self._gridInfos.level   = parseInt(data.force, 10);

  data.grille.forEach(function(row) {
    for (var j = 0; j < row.length; j++) {
      type = getCaseType(row[j]);

      if (type === enums.CaseType.Letter) {
        grid.cases.push(new Case.LetterCase(currentCase++, row[j]));
        self._nbLetters++;
      }
      else if (type === enums.CaseType.Description) {
        grid.cases.push(new Case.DescriptionCase(currentCase++, row[j]));
      }
      else {
        grid.cases.push(new Case.EmptyCase(currentCase++));
      }
    }
  });

  data.definitions.forEach(function(defArray) {
    var defText = Array.isArray(defArray) ? defArray.join('\n') : String(defArray);
    insertDescription(grid, defText);
  });

  placeArrows(grid);
  self._grid = grid;
}

function placeArrows(grid) {
  var i,
      gridSize = grid.cases.length;

  for (i = 0; i < gridSize; i++) {
    if (grid.cases[i].type == enums.CaseType.Description) {
      switch (grid.cases[i].value) {
        case 'a':
          grid.cases[i].arrow[0] = enumArrow.Right;
          break;
        case 'b':
          grid.cases[i].arrow[0] = enumArrow.Bottom;
          break;
        case 'c':
          grid.cases[i].arrow[0] = enumArrow.RightBottom;
          break;
        case 'd':
          grid.cases[i].arrow[0] = enumArrow.BottomRight;
          break;
        case 'f':
        case 'g':
        case 'h':
          grid.cases[i].arrow[0] = enumArrow.Right;
          grid.cases[i].arrow[1] = enumArrow.Bottom;
          break;
        case 'k':
        case 'l':
        case 'm':
          grid.cases[i].arrow[0] = enumArrow.RightBottom;
          grid.cases[i].arrow[1] = enumArrow.Bottom;
          break;
        case 'p':
        case 'q':
        case 'r':
          grid.cases[i].arrow[0] = enumArrow.Right;
          grid.cases[i].arrow[1] = enumArrow.BottomRight;
          break;
        case 'v':
        case 'w':
          grid.cases[i].arrow[0] = enumArrow.RightBottom;
          grid.cases[i].arrow[1] = enumArrow.BottomRight;
          break;
        case 's':
        case 't':
        case 'u':
          grid.cases[i].arrow[0] = enumArrow.Bottom;
          grid.cases[i].arrow[1] = enumArrow.BottomRight;
          break;
        default: {
          var colIdx = i % grid.nbLines;
          var hasRight = (colIdx + 1 < grid.nbLines) && grid.cases[i + 1] && (grid.cases[i + 1].type === enums.CaseType.Letter);
          var hasBelow = (i + grid.nbLines < grid.cases.length) && grid.cases[i + grid.nbLines] && (grid.cases[i + grid.nbLines].type === enums.CaseType.Letter);
          var arrowIdx = 0;
          if (hasRight) { grid.cases[i].arrow[arrowIdx++] = enumArrow.Right; }
          if (hasBelow) { grid.cases[i].arrow[arrowIdx] = enumArrow.Bottom; }
          console.warn('[WARN][gridManager::placeArrows] Unknown arrow type [' + grid.cases[i].value + '] at frame ' + i + ', inferred arrows from context');
        }
      }
    }
  }
}

function getGridAddress(self, commandArgv) {
  var gridNumber,
      today,
      gridDefaultDay,
      dayDiff;

  switch (commandArgv) {
    case 0:
      console.info('\n\t[GRIDMANAGER] Load day grid');
      gridDefaultDay = new Date(config.PROVIDER_DEFAULT_GRID_DATE);
      today = new Date();
      dayDiff = Math.abs(today.getTime() - gridDefaultDay.getTime());
      dayDiff = Math.floor(dayDiff / (1000 * 3600 * 24));
      gridNumber = config.PROVIDER_DEFAULT_GRID + dayDiff;
      break;
    case -1:
      console.info('\n\t[GRIDMANAGER] Load default grid');
      gridNumber = config.PROVIDER_DEFAULT_GRID;
      break;
    default:
      console.info('\n\t[GRIDMANAGER] Load specific grid');
      gridNumber = commandArgv;
      break;
  }

  self._gridInfos.provider = config.PROVIDER_NAME;
  self._gridInfos.id = gridNumber;

  return (config.PROVIDER_ADDR + gridNumber.toString() + config.PROVIDER_EXTENSION);
}

/* PUBLIC METHODS */

GridManager.prototype.checkPlayerWord = function (wordObj) {
  var jump      = (wordObj.axis == 0) ? 1 : this._grid.nbLines,
      wordSize  = wordObj.word.length,
      points    = 0,
      index     = wordObj.start,
      i;

  for (i = 0; i < wordSize; i++) {
    if (wordObj.word[i] != this._grid.cases[index].value)
      return (-1);

    if (this._grid.cases[index].available == true)
      points++;

    index += jump;
  }

  // All letters already found — reject (no points, no bonus)
  if (points === 0) return (-1);

  index = wordObj.start;
  for (i = 0; i < wordSize; i++) {
    if (this._grid.cases[index].available == true)
      this._grid.cases[index].available = false;
    index += jump;
  }

  this._grid.nbWords--;

  return (points);
};

GridManager.prototype.getGrid = function () {
  var clonedGrid,
      index;

  clonedGrid = JSON.parse(JSON.stringify(this._grid));
  clonedGrid.infos = this._gridInfos;

  for (index in clonedGrid.cases) {
    if (clonedGrid.cases[index].type == enums.CaseType.Letter)
      clonedGrid.cases[index].value = '';
  }

  return (clonedGrid);
};

/*
* Returns a full grid clone including actual letter values (used for solo mode).
*/
GridManager.prototype.getFullGrid = function () {
  var clonedGrid = JSON.parse(JSON.stringify(this._grid));
  clonedGrid.infos = this._gridInfos;
  return (clonedGrid);
};

GridManager.prototype.getGridInfos = function () {
  return (this._gridInfos);
};

GridManager.prototype.getNbRemainingWords = function () {
  return (this._grid.nbWords);
};

GridManager.prototype.getAccomplishmentRate = function (playerPoints, nbPlayers) {
  if (this._maxPoints == 0) {
    switch (nbPlayers) {
      case 1:  this._maxPoints = Math.floor(this._nbLetters * 1.5); break;
      case 2:  this._maxPoints = Math.floor(this._nbLetters * 0.9); break;
      case 3:  this._maxPoints = Math.floor(this._nbLetters * 0.75); break;
      case 4:  this._maxPoints = Math.floor(this._nbLetters * 0.66); break;
      default: this._maxPoints = this._nbLetters; break;
    }
  }

  return (Math.floor(playerPoints / this._maxPoints * 100));
};

/*
* Retreive and parse the grid. Checks the raw text cache before making a network request.
* If the requested grid fails, falls back to PROVIDER_FIRST_GRID.
*/
GridManager.prototype.retreiveAndParseGrid = function (gridNumber, callback) {
  var self = this;
  var gridAddr = getGridAddress(self, gridNumber);
  var resolvedId = self._gridInfos.id;

  console.info('\n\t[GRIDMANAGER] Try to load ' + gridAddr);

  function loadFromText(text, id) {
    _rawGridCache[id] = text;
    parseGrid(self, callback, text);
    callback(self._grid);
  }

  function saveToDisk(id, text) {
    fs.writeFile(path.join(CACHE_DIR, id + '.mfj'), text, function(err) {
      if (err) console.warn('\t[GRIDMANAGER] Could not write cache file: ' + err.message);
    });
  }

  // 1. Check in-memory cache
  if (_rawGridCache[resolvedId]) {
    console.info('\t[GRIDMANAGER] Memory cache hit for grid #' + resolvedId);
    loadFromText(_rawGridCache[resolvedId], resolvedId);
    return;
  }

  // 2. Check disk cache
  var diskFile = path.join(CACHE_DIR, resolvedId + '.mfj');
  if (fs.existsSync(diskFile)) {
    console.info('\t[GRIDMANAGER] Disk cache hit for grid #' + resolvedId);
    var diskText = fs.readFileSync(diskFile, 'utf8');
    loadFromText(diskText, resolvedId);
    return;
  }

  // 3. Download from network
  var req = https.get(gridAddr, function (res) {
    // If the grid is not found, try the fallback
    if (res.statusCode !== 200) {
      res.resume(); // Consume and discard response body
      var fallback = config.PROVIDER_FIRST_GRID;
      console.warn('\t[GRIDMANAGER] Grid not found (HTTP ' + res.statusCode + '), falling back to #' + fallback);
      self._gridInfos.provider = config.PROVIDER_NAME;
      self._gridInfos.id = fallback;

      if (_rawGridCache[fallback]) {
        loadFromText(_rawGridCache[fallback], fallback);
        return;
      }
      var diskFallback = path.join(CACHE_DIR, fallback + '.mfj');
      if (fs.existsSync(diskFallback)) {
        console.info('\t[GRIDMANAGER] Disk cache hit for fallback grid #' + fallback);
        loadFromText(fs.readFileSync(diskFallback, 'utf8'), fallback);
        return;
      }

      var fallbackAddr = config.PROVIDER_ADDR + fallback + config.PROVIDER_EXTENSION;
      var fallbackReq = https.get(fallbackAddr, function (res2) {
        if (res2.statusCode !== 200) {
          res2.resume();
          onGetGridError(callback, 'Fallback grid also failed (HTTP ' + res2.statusCode + ')');
          return;
        }
        var chunks = [];
        res2.on('data', function (chunk) { chunks.push(chunk); });
        res2.on('end', function () {
          var text = Buffer.concat(chunks).toString();
          saveToDisk(fallback, text);
          console.info('\n\t[GRIDMANAGER] Fallback grid loaded: ' + config.PROVIDER_NAME + ' #' + fallback);
          loadFromText(text, fallback);
        });
      });
      fallbackReq.on('error', function (e) { onGetGridError(callback, e.message); });
      return;
    }

    var bodyChunks = [];
    res.on('data', function (chunk) { bodyChunks.push(chunk); });
    res.on('end', function () {
      console.info('\t[GRIDMANAGER] Grid downloaded, start parsing...\n');
      var text = Buffer.concat(bodyChunks).toString();
      saveToDisk(resolvedId, text);
      console.info('\n\t[GRIDMANAGER] Parsing Done. Now play ' + self._gridInfos.provider + ' ' + self._gridInfos.id + ' - Level ' + self._gridInfos.level);
      loadFromText(text, resolvedId);
    });
  });

  req.on('error', function (e) { onGetGridError(callback, e.message); });
};

GridManager.prototype.resetGrid = function (gridNumber, callback) {
  this._grid = null;
  this._wordsPoints = null;
  this._theme = null;
  this._nbLetters = 0;
  this._lastSearchCase = 0;
  this._maxPoints = 0;
  this._gridInfos.id = 0;
  this._gridInfos.level = 0;
  this._gridInfos.nbWords = 0;

  this.retreiveAndParseGrid(gridNumber, callback);
};

module.exports = GridManager;
