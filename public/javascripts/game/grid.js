/*
*   The Grid class manage the displayed game grid and the Cursor
*/
define(['cursor'], function (Cursor) {

  var REVEAL_WORD_ANIM_DELAY  = 50;

  var CaseType = {
    All: 1,
    Letter: 2,
    Description: 3,
    Empty: 4
  };

  var AxisType = {
    Horizontal: 0,
    Vertical:   1
  };

  var _grid,
      _wordValidationCallback,
      _cursor;
  
  function Grid(gridObj, wordValidationCallback) {
    // Save grid object
    _grid = gridObj;

    // Remember word validation callback
    _wordValidationCallback = wordValidationCallback;

    // Instanciate cursor class
    _cursor = new Cursor(gridObj, onNewLetterPrinted);
  }


  function insertDescription(line, column, size, info) {
    var frame = document.createElement('div'),
        lineHeight,
        fontSize,
        descNode,
        i;

    frame.className = 'frame description frame' + info.pos;
    frame.style.width = size + 'px';
    frame.style.height = size + 'px';
    frame.style.top = (line * size) + 'px';
    frame.style.left = (column * size) + 'px';

    frame.setAttribute('data-line', line);
    frame.setAttribute('data-col', column);
    frame.setAttribute('data-pos', info.pos);

    if (info.nbLines === 1) {
      lineHeight = size;
      fontSize = Math.max(9, Math.floor(size / 5.7));
    } else {
      fontSize = Math.max(9, Math.floor(size / 5.8));
      lineHeight = Math.max(fontSize, Math.floor(size / info.nbLines * 0.88));
    }

    frame.style.lineHeight = lineHeight + 'px';
    frame.style.fontSize = fontSize + 'px';

    var fullParts = [];
    for (i = 0; i < info.nbDesc; i++) {
      descNode = document.createElement('span');
      descNode.innerHTML = info.desc[i];
      frame.appendChild(descNode);
      fullParts.push(info.desc[i]);
    }
    frame.setAttribute('data-desc', fullParts.join(' | '));

    return frame;
  }

  // dir: 0=Right, 1=RightBottom, 2=Bottom, 3=BottomRight
  function createDescriptionArrows(line, col, size, info) {
    var arrows = [];
    var arrowSize = Math.max(5, Math.floor(size / 7));
    var arrowLong = Math.round(arrowSize * 1.4);
    var el;

    for (var i = 0; i < info.nbDesc; i++) {
      var dir = info.arrow[i];
      if (dir === null || dir === undefined) continue;

      var spanCenterY = line * size + ((i + 0.5) / info.nbDesc) * size;
      var spanCenterX = col  * size + size / 2;
      var spanBottomY = line * size + ((i + 1)   / info.nbDesc) * size;

      if (dir === 0) {
        // → : at left edge of right letter cell, pointing right, centered in span
        el = document.createElement('i');
        el.className  = 'grid-arrow';
        el.style.left = ((col + 1) * size) + 'px';
        el.style.top  = Math.round(spanCenterY - arrowSize) + 'px';
        el.style.borderTop    = arrowSize + 'px solid transparent';
        el.style.borderBottom = arrowSize + 'px solid transparent';
        el.style.borderLeft   = arrowLong + 'px solid #e8c840';
        arrows.push(el);

      } else if (dir === 2) {
        // ↓ : at top edge of bottom letter cell, pointing down, centered in column
        el = document.createElement('i');
        el.className  = 'grid-arrow';
        el.style.top  = ((line + 1) * size) + 'px';
        el.style.left = Math.round(spanCenterX - arrowSize) + 'px';
        el.style.borderLeft  = arrowSize + 'px solid transparent';
        el.style.borderRight = arrowSize + 'px solid transparent';
        el.style.borderTop   = arrowLong + 'px solid #e8c840';
        arrows.push(el);

      } else if (dir === 1) {
        // →↓ : single arrow at RIGHT EDGE of span, pointing DOWN (corner indicator)
        el = document.createElement('i');
        el.className  = 'grid-arrow';
        el.style.left = ((col + 1) * size) + 'px';
        el.style.top  = Math.round(spanBottomY - arrowLong) + 'px';
        el.style.borderLeft  = arrowSize + 'px solid transparent';
        el.style.borderRight = arrowSize + 'px solid transparent';
        el.style.borderTop   = arrowLong + 'px solid #e8c840';
        arrows.push(el);

      } else if (dir === 3) {
        // ↓→ : single arrow at BOTTOM EDGE of span, pointing RIGHT (corner indicator)
        el = document.createElement('i');
        el.className  = 'grid-arrow';
        el.style.left = Math.round((col + 1) * size - arrowLong) + 'px';
        el.style.top  = Math.round(spanBottomY) + 'px';
        el.style.borderTop    = arrowSize + 'px solid transparent';
        el.style.borderBottom = arrowSize + 'px solid transparent';
        el.style.borderLeft   = arrowLong + 'px solid #e8c840';
        arrows.push(el);
      }
    }

    return arrows;
  }

  function insertLetter(line, column, size, info, index) {
    var frame = document.createElement('div');

    // Set class
    frame.className = 'frame letter frame' + info.pos;
    // Set size
    frame.style.width = size + 'px';
    frame.style.height = size + 'px';
    // Set position
    frame.style.top = (line * size) + 'px';
    frame.style.left = (column * size) + 'px';

    // Set extra style
    frame.style.lineHeight = size + 'px';
    frame.style.fontSize = Math.floor(size * 0.6) + 'px';
    frame.setAttribute('data-line', line);
    frame.setAttribute('data-col', column);
    frame.setAttribute('data-pos', info.pos);
    frame.tabIndex = index;

    if (info.dashed)
      frame.classList.add('dash' + info.dashed);

    // Adding extra parameter
    info.available = true;
    info.letter = null;

    return (frame);
  }

  function insertEmptyFrame(line, column, size, info) {
    var frame = document.createElement('div');

    // Set class
    frame.className = 'frame empty frame' + info.pos;
    // Set size
    frame.style.width = size + 'px';
    frame.style.height = size + 'px';
    // Set position
    frame.style.top = (line * size) + 'px';
    frame.style.left = (column * size) + 'px';

    // Set extra style
    frame.setAttribute('data-line', line);
    frame.setAttribute('data-col', column);
    frame.setAttribute('data-pos', info.pos);

    return (frame);
  }

  function showDescPopup(text) {
    var popup = document.getElementById('desc-popup');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'desc-popup';
      popup.addEventListener('click', function (e) { e.stopPropagation(); });
      document.body.appendChild(popup);
      document.body.addEventListener('click', function () {
        var p = document.getElementById('desc-popup');
        if (p) p.classList.remove('visible');
      });
    }
    if (popup.classList.contains('visible') && popup.getAttribute('data-current') === text) {
      popup.classList.remove('visible');
    } else {
      popup.innerHTML = text;
      popup.setAttribute('data-current', text);
      popup.classList.add('visible');
    }
  }

  function getFrameAxisNumber(index, axis) {
    if (axis == AxisType.Horizontal) {
      return (Math.floor(index / _grid.nbLines));
    }
    else {
      return (index % _grid.nbLines);
    }
  }

  /*
  *   This function will search an entire word on a specified axis from initialPos.
  *   If the function cannot buil a complete word (letter is missing), return null
  *   @param {Int}  initialPos  The start position in grid
  *   @param {Enum} axis        Axis of the research. Must be AxisType.Horizontal or AxisType.Vertical
  *   @return {Object}  An object representing the word founded or null if we cannot retreive a complete word
  */
  function findWord(initialPos, axis) {
    var word    = _grid.cases[initialPos].letter,
        jump    = (axis == AxisType.Horizontal) ? 1 : _grid.nbLines, // The axis will define how many frames we have to jump to retreive the next letter
        i       = initialPos - jump,
        wordAxe = getFrameAxisNumber(initialPos, axis),
        firstLetterIndex  = 0;

    // While we have a letter before the current position, continue to compute word
    while ((_grid.cases[i]) && (getFrameAxisNumber(i, axis) == wordAxe) && (_grid.cases[i].type == CaseType.Letter)) {
      // Adding letter and continue
      if (_grid.cases[i].letter != null)
        word = _grid.cases[i].letter + word;
      // Else there is a hole in this word, exit
      else
        return (null);

      // Go to the previous letter
      i -= jump;
    }
    // Save first letter pos
    firstLetterIndex = i + jump;

    // Now finish the word in the other direction
    i = initialPos + jump;
    while ((_grid.cases[i]) && (getFrameAxisNumber(i, axis) == wordAxe) && (_grid.cases[i].type == CaseType.Letter)) {
      // Adding letter and continue
      if (_grid.cases[i].letter != null)
        word += _grid.cases[i].letter;
      // Else there is a hole in this word, exit
      else
        return (null);

      // Go to the next letter
      i += jump;
    }

    // Ignore false detection of 1 letter word 
    if (word.length <= 1)
      return (null);

    // console.log('Mot ' + ((axis == AxisType.Horizontal) ? 'horizontal' : 'vertical') + ' trouvé: [' + word + ']');
    return  ( { 'axis': axis, 'word': word, 'start': firstLetterIndex } );
  }


  /*
  *   Grid callback raise when a new letter is printed on the grid
  *   @param {Int}    pos     Index of the new letter in grid
  *   @param {String} letter  Letter inserted
  */
  function onNewLetterPrinted(pos, letter) {
    var wordObj;

    // Update letter in grid
    _grid.cases[pos].letter = letter;

    // If the letter is valid, check for words
    if (letter != null) {
      // Try to find an horizontaly word
      wordObj = findWord(pos, AxisType.Horizontal);
      if (wordObj != null)
        _wordValidationCallback(wordObj);

      // ... Then a vertical one
      wordObj = findWord(pos, AxisType.Vertical);
      if (wordObj != null)
        _wordValidationCallback(wordObj);
    }
  }

  
  /*
  * Function called when a players has found a word. Display it on the grid in the right color
  */
  Grid.prototype.RevealWord = function (wordObj) {
    var index = wordObj.start,
        jump = (wordObj.axis == AxisType.Horizontal) ? 1 : _grid.nbLines,
        size = wordObj.word.length,
        i,
        node,
        animationDelay = 0;

    for (i = 0; i < size; i++) {
      // If this letter is a just found
      if (_grid.cases[index].available == true) {
        // Update grid object
        _grid.cases[index].letter = wordObj.word[i];
        _grid.cases[index].available = false;

        // Display it
        node = document.querySelector('.frame' + index);
        if (!node) { index += jump; continue; }
        node.style.cssText += '-webkit-transition-delay: ' + animationDelay + 'ms; transition-delay: ' + animationDelay + 'ms; color: ' + wordObj.color;
        node.classList.add('reveal' + wordObj.axis);
        node.innerHTML = _grid.cases[index].letter;
        
        animationDelay += REVEAL_WORD_ANIM_DELAY;
      }

      index += jump;
    };
  };


  /*
  * Display the grid on the game screen 
  */
  Grid.prototype.DisplayGrid = function () {
    var container = document.getElementById('gs-grid-container'),
        limit,
        frameSize,
        line, col,
        nbFrames = _grid.cases.length,
        i;

    // Compute frame size from the container's smaller dimension.
    // On mobile the container may be very narrow so we enforce a minimum of
    // 30 px per cell and let the container scroll horizontally if needed.
    limit = (container.offsetWidth < container.offsetHeight) ? container.offsetWidth : container.offsetHeight;

    frameSize = (_grid.nbLines > _grid.nbColumns) ? _grid.nbLines : _grid.nbColumns;
    frameSize = Math.max(30, Math.floor(limit / frameSize));
    // console.log('Taille de case: ' + frameSize);

    // For each frame
    for (i = 0; i < nbFrames; i++) {
      // Get line and col
      line = Math.floor(i / _grid.nbLines);
      col = i % _grid.nbLines;

      // Insert frame
      if (_grid.cases[i].type == CaseType.Letter)
        container.appendChild(insertLetter(line, col, frameSize, _grid.cases[i], i));
      else if (_grid.cases[i].type == CaseType.Description) {
        container.appendChild(insertDescription(line, col, frameSize, _grid.cases[i]));
        var descArrows = createDescriptionArrows(line, col, frameSize, _grid.cases[i]);
        for (var a = 0; a < descArrows.length; a++) container.appendChild(descArrows[a]);
      }
      else
        container.appendChild(insertEmptyFrame(line, col, frameSize, _grid.cases[i]));

    };

    // Bind description tap-to-popup for small screens
    var descFrames = container.querySelectorAll('.description');
    for (var d = 0; d < descFrames.length; d++) {
      descFrames[d].addEventListener('click', function (e) {
        showDescPopup(e.currentTarget.getAttribute('data-desc'));
        e.stopPropagation();
      });
    }

    // Bind events after a short delay to be sure all new DOM content are injected
    window.setTimeout(function () {
      _cursor.RegisterEvents();
    }, 100);
    
  };

  /*
  * Clear all typed-but-unvalidated letters from the grid
  */
  Grid.prototype.clearUnvalidated = function () {
    for (var i = 0; i < _grid.cases.length; i++) {
      var c = _grid.cases[i];
      if (c.type === CaseType.Letter && c.available === true && c.letter !== null) {
        c.letter = null;
        var node = document.querySelector('.frame' + i);
        if (node) node.innerHTML = '';
      }
    }
  };

  /*
  * Reset the grid to prepare a new game
  */
  Grid.prototype.resetGrid = function () {
    var container = document.getElementById('gs-grid-container').innerHTML = '';
  };
  

  return (Grid);
  
});