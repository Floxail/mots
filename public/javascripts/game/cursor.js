/*
*   The cursor is used to focus a special frame and write in it.
*   Mobile support: a hidden <input> captures keyboard input so the native
*   iOS/Android keyboard opens when a letter cell is tapped.
*/
define(function () {

  var enumDirections = {
    Left:  37,
    Up:    38,
    Right: 39,
    Down:  40
  };

  var _grid,
      _letterUpdateCallback,
      _nbLines,
      _nbCols,
      _focusCell      = null,
      _focusDirection = null,
      _mobileInput    = null; // hidden <input> for native mobile keyboard


  /*
  *   Constructor
  */
  function Cursor(gridObj, letterUpdateCallback) {
    _grid                 = gridObj.cases;
    _nbLines              = gridObj.nbLines;
    _nbCols               = gridObj.nbColumns;
    _letterUpdateCallback = letterUpdateCallback;
  }


  /*-----------------------------------------------------------------------
      Private helpers
  -----------------------------------------------------------------------*/

  /*
  * Create (once) the hidden <input> used to capture keyboard on mobile.
  * autocapitalize="characters" nudges iOS to open the all-caps keyboard.
  */
  function ensureMobileInput() {
    if (_mobileInput) return;

    _mobileInput                 = document.createElement('input');
    _mobileInput.type            = 'text';
    _mobileInput.autocomplete    = 'off';
    _mobileInput.autocorrect     = 'off';
    _mobileInput.autocapitalize  = 'characters';
    _mobileInput.setAttribute('inputmode', 'text');
    _mobileInput.style.cssText   =
      'position:fixed;top:-200px;left:0;opacity:0;width:1px;height:1px;' +
      'border:none;padding:0;margin:0;font-size:16px;'; // font-size≥16 avoids iOS zoom
    document.body.appendChild(_mobileInput);

    // Character typed on mobile keyboard
    _mobileInput.addEventListener('input', function () {
      if (!_focusCell) { _mobileInput.value = ''; return; }
      var val = _mobileInput.value.toUpperCase();
      _mobileInput.value = '';
      if (!val) return;
      // Take only the last character in case of autocorrect inserting multiple
      var ch = val.charAt(val.length - 1);
      var code = ch.charCodeAt(0);
      if (code >= 65 && code <= 90) insertLetter(code);
    });

    // Backspace / delete on mobile keyboard
    _mobileInput.addEventListener('keydown', function (e) {
      if (!_focusCell) return;
      if (e.keyCode === 8 || e.keyCode === 46) {
        removeLetter();
        e.preventDefault();
      }
      if (e.keyCode >= 37 && e.keyCode <= 40) {
        moveCursor(e.keyCode);
        e.preventDefault();
      }
    });
  }

  function focusMobileInput() {
    ensureMobileInput();
    _mobileInput.value = '';
    _mobileInput.focus();
  }


  function setCursorDirection(direction) {
    if (!direction) {
      if (_focusDirection == enumDirections.Right) {
        _focusCell.classList.remove('goRight');
        _focusCell.classList.add('goDown');
        _focusDirection = enumDirections.Down;
      } else {
        _focusCell.classList.remove('goDown');
        _focusCell.classList.add('goRight');
        _focusDirection = enumDirections.Right;
      }
    } else {
      _focusDirection = (_focusDirection == enumDirections.Right) ? enumDirections.Down : enumDirections.Right;
      _focusCell.classList.remove('goRight');
      _focusCell.classList.remove('goDown');
      if (_focusDirection == enumDirections.Right)
        _focusCell.classList.add('goRight');
      else
        _focusCell.classList.add('goDown');
    }
  }

  function moveCursor(direction) {
    var frameNumber = parseInt(_focusCell.getAttribute('data-pos')),
        index       = 0;

    if (direction == undefined) direction = _focusDirection;

    switch (direction) {
      case enumDirections.Left:
        index = frameNumber - 1;
        break;
      case enumDirections.Right:
        index = ((frameNumber + 1) >= _grid.length) ? 0 : (frameNumber + 1);
        break;
      case enumDirections.Up:
        index = (frameNumber > _nbLines) ? (frameNumber - _nbLines) : 0;
        break;
      case enumDirections.Down:
        index = ((frameNumber + _nbLines) >= _grid.length) ? 0 : (frameNumber + _nbLines);
        break;
      default:
        console.log('[ERROR] [Cursor.moveCursor] Unknown direction ' + direction);
    }

    if (_grid[index].type == 2) {
      _focusCell.classList.remove('goRight');
      _focusCell.classList.remove('goDown');
      _focusCell.classList.remove('focusCell');

      _focusCell = document.querySelector('.frame' + index);
      _focusCell.classList.add('focusCell');
      if (direction == enumDirections.Left || direction == enumDirections.Right) {
        _focusDirection = enumDirections.Right;
        _focusCell.classList.add('goRight');
      } else {
        _focusDirection = enumDirections.Down;
        _focusCell.classList.add('goDown');
      }
      return true;
    }
    return false;
  }

  function activateCell(target) {
    if (_focusCell != null) {
      if (_focusCell == target) {
        setCursorDirection();
        focusMobileInput();
        return;
      }
      _focusCell.classList.remove('goRight');
      _focusCell.classList.remove('goDown');
      _focusCell.classList.remove('focusCell');
    }
    _focusCell = target;
    _focusCell.classList.add('focusCell');
    _focusCell.classList.add('goRight');
    _focusDirection = enumDirections.Right;
    focusMobileInput();
  }

  function onClickReceived(event) {
    activateCell(event.target);
  }

  function onLetterPressed(event) {
    var key = event.keyCode;
    if ((key >= 65) && (key <= 90)) insertLetter(key);
    if ((key == 8) || (key == 27) || (key == 46)) { removeLetter(); event.preventDefault(); }
    if ((key >= 37) && (key <= 40)) moveCursor(key);
  }

  function insertLetter(letter) {
    var character = String.fromCharCode(letter),
        pos       = parseInt(_focusCell.getAttribute('data-pos'));

    if ((_focusCell != null) && (_grid[pos].available == true)) {
      _focusCell.innerHTML = character;
      _letterUpdateCallback(pos, character);
    }
    moveCursor(_focusDirection);
  }

  function removeLetter() {
    var pos = parseInt(_focusCell.getAttribute('data-pos'));
    if (_grid[pos].available == true && _grid[pos].letter !== null) {
      // Cell has a typed letter — erase it, stay in place
      _focusCell.innerHTML = '';
      _letterUpdateCallback(pos, null);
    } else {
      // Cell is empty or validated — move backward
      var backDir = (_focusDirection == enumDirections.Right) ? enumDirections.Left : enumDirections.Up;
      moveCursor(backDir);
    }
  }


  /*-----------------------------------------------------------------------
      Public methods
  -----------------------------------------------------------------------*/

  Cursor.prototype.RegisterEvents = function () {
    var letterCases = document.querySelectorAll('.letter'),
        size        = letterCases.length,
        i;

    for (i = 0; i < size; i++) {
      // Desktop: click + keyboard
      letterCases[i].addEventListener('click', onClickReceived, false);
      letterCases[i].addEventListener('keydown', onLetterPressed, false);

      // Mobile: touchend activates the cell and opens the native keyboard.
      // preventDefault() stops the 300 ms ghost click on iOS.
      letterCases[i].addEventListener('touchend', function (e) {
        e.preventDefault();
        activateCell(e.currentTarget);
      }, { passive: false });
    }
  };


  return (Cursor);

});
