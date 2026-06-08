/*
*   The Score class manage the score panel. It has to maintain the player list and refresh score during the game
*/
define(function () {

  var SCORE_BAR_PERCENT_WIDTH   = 21;
  var DELAY_BETWEEN_BONUSES     = 200;

  // playerID -> hex color string (populated by UpdatePlayerList)
  var _playerColors    = {};
  // playerID -> array of word strings (populated by trackWord)
  var _playerWords     = {};
  // playerID -> progress % (populated by RefreshScore, applied when rebuilding DOM)
  var _playerProgress  = {};


  /*
  *   Constructor
  */
  function Score () {

  };

  /* Private functions */

  function _renderWordList(playerID, color) {
    var el = document.getElementById('words-' + playerID);
    if (!el) return;
    var words = _playerWords[playerID] || [];
    el.innerHTML = words.map(function(w) {
      return '<span class="word-tag" style="background:' + color + '">' + w + '</span>';
    }).join('');
  }

  /* Public functions */

  /*
  * On new player list received
  * @param: {Array}  playerList   Array of players
  */
  Score.prototype.UpdatePlayerList = function(playerList) {
    var i,
        nbPlayers = playerList.length,
        scoreNode = document.getElementById('gs-scores');

    scoreNode.innerHTML = '';

    for (i = 0; i < nbPlayers; i++) {
      if (playerList[i].monster) {
        _playerColors[playerList[i].id] = playerList[i].monster.color;
        if (!_playerWords[playerList[i].id]) _playerWords[playerList[i].id] = [];
        scoreNode.innerHTML += '<article id="player' + playerList[i].id + '" class="playerScore bloc' + nbPlayers + '">' +
          '<div class="score-bar" style="background-color: ' + playerList[i].monster.color + '; height: ' + (_playerProgress[playerList[i].id] || 0) + '%">' +
          '<img src="' + playerList[i].monster.path + '"></div>' +
          '<footer>' +
          '<h3>' + playerList[i].nick + '</h3>' +
          '<strong>' + playerList[i].score + ' points</strong>' +
          '<span>' + playerList[i].nbWords + ' mots</span>' +
          '<div class="player-word-list" id="words-' + playerList[i].id + '"></div>' +
          '</footer></article>';
      }
    }

    // Re-render word lists for players we already have data for
    for (i = 0; i < nbPlayers; i++) {
      _renderWordList(playerList[i].id, playerList[i].monster ? playerList[i].monster.color : '#fff');
    }
  };

  /*
  * Track a word found by a player (identified by color)
  * @param: {Object}  wordObj   {word, color}
  */
  Score.prototype.trackWord = function(wordObj) {
    // Find playerID by matching color
    var pid = null;
    for (var id in _playerColors) {
      if (_playerColors[id] === wordObj.color) { pid = id; break; }
    }
    if (pid === null) return;
    if (!_playerWords[pid]) _playerWords[pid] = [];
    _playerWords[pid].push(wordObj.word);
    _renderWordList(pid, wordObj.color);
  };

  /*
  * When a player scores, we have to refresh his infos !
  * @param: {Array}  playerList   Array of players
  */
  Score.prototype.RefreshScore = function(scoreObj) {
    var scoreNode = document.getElementById('player' + scoreObj.playerID),
        bonusNode,
        animationDelay = 0,
        nbBonuses,
        i;

    // Update player progress bar
    _playerProgress[scoreObj.playerID] = scoreObj.progress;
    document.querySelector('#player' + scoreObj.playerID + ' > div').style.height = scoreObj.progress + '%';

    // Update score and nb words
    document.querySelector('#player' + scoreObj.playerID + ' > footer > strong').innerHTML = scoreObj.score + ' points';
    document.querySelector('#player' + scoreObj.playerID + ' > footer > span').innerHTML = scoreObj.words + ' mots';

    // For each bonus to display, if any
    for (i = 0, nbBonuses = scoreObj.bonus.length; i < nbBonuses; i++) {
      // Create bonus text node
      bonusNode = document.createElement('span');
      bonusNode.className = 'bonus';
      // Adding delay before apparition for multiple bonuses
      bonusNode.style.cssText = '-webkit-animation-delay: ' + animationDelay + 'ms; -moz-animation-delay: ' + animationDelay + 'ms; animation-delay: ' + animationDelay + 'ms;';
      bonusNode.innerHTML = scoreObj.bonus[i].title + '<br/>+ ' + scoreObj.bonus[i].points + ' pts';

      // Add event listener on animation end to properly remove the node
      bonusNode.addEventListener('animationend', function (event) {
        // Remove node when animation ends
        scoreNode.removeChild(event.target);
      }, false);
      bonusNode.addEventListener('webkitAnimationEnd', function (event) {
        // Remove node when animation ends
        scoreNode.removeChild(event.target);
      }, false);

      // Adding bonus in DOM and increase delay before the next bonus
      scoreNode.appendChild(bonusNode);
      animationDelay += DELAY_BETWEEN_BONUSES;
    };

  };

  /*
  * Reset player's score to prepare for a new game
  * @param: {Array}  playerList   Array of players
  */
  Score.prototype.resetScores = function() {
    var scoreNodes = document.querySelectorAll('.playerScore'),
        size, i;

    _playerColors   = {};
    _playerWords    = {};
    _playerProgress = {};

    for (i = 0, size = scoreNodes.length; i < size; i++) {
      scoreNodes[i].querySelector('div').style.height = '0%';
      scoreNodes[i].querySelector('footer > strong').innerHTML = '0 points';
      scoreNodes[i].querySelector('footer > span').innerHTML = '0 mots';
      var wl = scoreNodes[i].querySelector('.player-word-list');
      if (wl) wl.innerHTML = '';
    }

  };


  return (Score);

});
