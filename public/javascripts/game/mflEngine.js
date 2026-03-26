/*
*   Game Engine — handles lobby, multiplayer rooms, and solo mode
*/
require(['../lib/text!../../conf.json', 'UITools', 'grid', 'chat', 'score'], function (Conf, UITools, GridManager, Chat, Score) {

  var enumState = {
    Lobby:   0,
    Login:   1,
    Waiting: 2,
    OnGame:  3,
    Solo:    4
  };

  var enumPanels = {
    Lobby: 'lobby-panel',
    Login: 'login-panel',
    Game:  'game-panel',
    Error: 'error-panel'
  };

  var _gameState       = enumState.Lobby,
      _gridManager,
      _scoreManager,
      _ui,
      _chat,
      _socket,
      _soloGrid,
      _soloScore       = 0,
      _countdownTimer  = null,
      _wordFoundedHandler = null;

  Conf = JSON.parse(Conf);

  // ─── Bootstrap ────────────────────────────────────────────────────────────

  _ui           = new UITools();
  _scoreManager = new Score();

  startLobby();

  // ─── Lobby ────────────────────────────────────────────────────────────────

  function startLobby() {
    if (typeof io === 'undefined') {
      showError('Impossible de charger socket.io.<br/>Vérifiez l\'adresse du serveur.');
      return;
    }

    var socketUrl = Conf.SOCKET_ADDR + (Conf.SOCKET_PORT !== 80 && Conf.SOCKET_PORT !== 443 ? ':' + Conf.SOCKET_PORT : '');
    _socket = io.connect(socketUrl, { reconnect: false });

    _socket.on('connect', function () {
      console.log('Socket connecté');
      // Auto-join if URL contains a room code in the hash (#ABCD) or query (?room=ABCD)
      var roomCode = getRoomCodeFromURL();
      if (roomCode) joinRoom(roomCode);
    });

    _socket.on('roomList', updateLobbyRoomList);

    _socket.on('disconnect', function () {
      if (_gameState > enumState.Lobby) showError('Connexion au serveur perdue');
    });

    _socket.on('error', function () {
      showError('Impossible de se connecter au serveur.');
    });

    // Lobby button bindings
    document.getElementById('lobby-create-btn').onclick = function () {
      var raw  = document.getElementById('lobby-grid-input').value.trim();
      var opts = {};
      if (raw && !isNaN(parseInt(raw))) opts.gridNumber = parseInt(raw);
      _socket.emit('createRoom', opts);
      _socket.once('roomJoined', function (data) {
        setURLRoomCode(data.roomId);
        enterLoginPhase();
      });
      _socket.once('roomError', function (msg) {
        _ui.InfoTooltip(true, '<strong>Erreur :</strong> ' + msg, 4000);
      });
    };

    document.getElementById('lobby-join-btn').onclick = function () {
      var code = document.getElementById('lobby-code-input').value.trim().toUpperCase();
      if (!code) { _ui.InfoTooltip(true, 'Entrez un code de salle', 3000); return; }
      joinRoom(code);
    };

    document.getElementById('lobby-code-input').onkeydown = function (e) {
      if (e.key === 'Enter') document.getElementById('lobby-join-btn').click();
    };

    document.getElementById('lobby-solo-btn').onclick = startSoloMode;
  }

  function joinRoom(roomId) {
    _socket.emit('joinRoom', roomId);
    _socket.once('roomJoined', function (data) {
      setURLRoomCode(data.roomId);
      enterLoginPhase();
    });
    _socket.once('roomError', function (msg) {
      setURLRoomCode('');
      _ui.InfoTooltip(true, '<strong>Salle introuvable</strong> : ' + msg, 4000);
    });
  }

  function updateLobbyRoomList(rooms) {
    var container = document.getElementById('lobby-room-list');
    if (!rooms || rooms.length === 0) {
      container.innerHTML = '<p class="lobby-empty">Aucune salle disponible — créez-en une !</p>';
      return;
    }
    var html = '';
    rooms.forEach(function (room) {
      var stateCls   = room.gameState === 2 ? 'room-in-game' : 'room-waiting';
      var stateLabel = room.gameState === 2 ? 'En cours' : 'En attente';
      var gridLabel  = room.gridInfo
        ? 'Grille ' + room.gridInfo.id + ' (niv. ' + room.gridInfo.level + ')'
        : '<em>Chargement…</em>';
      html += '<div class="lobby-room-item">';
      html += '<span class="room-code">' + room.id + '</span>';
      html += '<span class="room-grid">' + gridLabel + '</span>';
      html += '<span class="room-status ' + stateCls + '">' + stateLabel + '</span>';
      html += '<span class="room-players">' + room.playerCount + '/9 joueurs</span>';
      html += '<button class="room-join-btn" data-id="' + room.id + '">Rejoindre</button>';
      html += '</div>';
    });
    container.innerHTML = html;
    container.querySelectorAll('.room-join-btn').forEach(function (btn) {
      btn.onclick = function () { joinRoom(btn.getAttribute('data-id')); };
    });
  }

  // ─── Login phase (after room joined) ──────────────────────────────────────

  function enterLoginPhase() {
    _gameState = enumState.Login;

    _socket.on('game_already_started', function () {
      localStorage.removeItem('mfl_nick');
      showError('Désolé, la partie a déjà commencée !');
    });

    _socket.on('room_closed', function () {
      showError('La salle a été fermée pour inactivité.');
    });

    _socket.on('logos', function (availableLogos) {
      if (_gameState > enumState.Login) return; // already past login

      var savedNick = localStorage.getItem('mfl_nick');

      if (availableLogos == null && !savedNick) {
        // No slot and no saved nick — show error
        document.getElementById('lp-infos').innerHTML = '';
        _ui.InfoTooltip(true, "<strong>Ho non, c'est balot !</strong><br/>Il semblerait qu'il n'y ai plus de place pour le jeu en cours.");
        return;
      }

      // Auto-rejoin if we have a saved nick (refresh / reconnect)
      if (savedNick) {
        _socket.emit('userIsReady', { nick: savedNick, monster: 0 });
        setupGameListeners();
        _ui.ChangeGameScreen(enumPanels.Game, true);
        _gameState = enumState.Waiting;
        _ui.bindServerCommandButtons(_socket);
        return;
      }

      // Normal login form
      prepareUserLoginForm(availableLogos);
      _ui.ChangeGameScreen(enumPanels.Login, true);
      document.getElementById('lp-start-btn').onclick = sendPlayerReady;
    });
  }

  // ─── Shared game listener setup ───────────────────────────────────────────

  function setupGameListeners() {
    _chat = new Chat(_socket, _scoreManager.UpdatePlayerList);
    _socket.on('grid_event', onStartGame);
    _socket.on('grid_reset', resetGame);
    _socket.on('score_update', _scoreManager.RefreshScore);
    _socket.on('game_over', function (winner) {
      _ui.displayGameOver(winner);
      _chat.congrats(winner);
    });
    // Replay previously found words when (re)joining a game in progress.
    // found_words arrives right after grid_event; onStartGame creates _gridManager
    // synchronously but DisplayGrid may not have run yet — use a short delay.
    _socket.on('found_words', function (words) {
      function replay() {
        if (!_gridManager) return;
        for (var i = 0; i < words.length; i++) {
          _gridManager.RevealWord(words[i]);
        }
      }
      // Small delay to ensure grid DOM is rendered before revealing
      setTimeout(replay, 300);
    });
  }

  // ─── Login form ───────────────────────────────────────────────────────────

  function prepareUserLoginForm(logoList) {
    var logosNodes = '',
        i,
        nbLogos    = logoList.length;

    for (i = 0; i < nbLogos; i++) {
      if (logosNodes.player == null)
        logosNodes += '<img class="lp-logos-monster" src="' + logoList[i].path + '" style="border-color: ' + logoList[i].color + '" data-monster-id="' + logoList[i].id + '">';
    }
    document.getElementById('lp-logos').innerHTML = logosNodes;

    logosNodes = document.querySelectorAll('.lp-logos-monster');
    nbLogos    = logosNodes.length;
    for (i = 0; i < nbLogos; i++) {
      logosNodes[i].onclick = function (event) {
        var oldSelection = document.querySelector('.myMonster');
        if (oldSelection) oldSelection.classList.remove('myMonster');
        event.target.classList.add('myMonster');
        document.getElementById('lp-nick').style.borderColor = event.target.style.borderColor;
      };
    }
  }

  function sendPlayerReady() {
    var nick        = document.getElementById('lp-nick').value,
        monsterNode = document.querySelector('.myMonster'),
        monster;

    if ((nick == '') || (monsterNode == null)) {
      _ui.InfoTooltip(true, 'Vous devez choisir un <strong>pseudo</strong> et un <strong>petit monstre</strong> !', 4000);
      return false;
    }

    monster = parseInt(monsterNode.getAttribute('data-monster-id'), 10);

    // Prevent double-submit
    document.getElementById('lp-start-btn').onclick = function () { return false; };

    setupGameListeners();

    localStorage.setItem('mfl_nick', nick);
    _socket.emit('userIsReady', { 'nick': nick, 'monster': monster });

    _ui.ChangeGameScreen(enumPanels.Game, true);
    _gameState = enumState.Waiting;
    _ui.bindServerCommandButtons(_socket);
    setPlayerColor(monsterNode.style.borderColor);

    return false;
  }

  // ─── Multiplayer game ─────────────────────────────────────────────────────

  function onStartGame(gridEvent) {
    // Clear any leftover countdown from a previous round
    if (_countdownTimer) { window.clearInterval(_countdownTimer); _countdownTimer = null; }

    _gridManager = new GridManager(gridEvent.grid, function (wordObj) {
      _socket.emit('wordValidation', wordObj);
    });

    // Replace the word_founded listener so it points to the new grid
    if (_wordFoundedHandler) _socket.off('word_founded', _wordFoundedHandler);
    _wordFoundedHandler = function (wordObj) { _gridManager.RevealWord(wordObj); };
    _socket.on('word_founded', _wordFoundedHandler);

    if (gridEvent.timer > 0) {
      _ui.InfoTooltip(true, '<strong>Tenez-vous prêt !</strong><br/>Début des hostilités dans <strong>' + (gridEvent.timer--) + '</strong>');
      _countdownTimer = window.setInterval(function () {
        _ui.InfoTooltip(true, '<strong>Tenez-vous prêt !</strong><br/>Début des hostilités dans <strong>' + (gridEvent.timer--) + '</strong>');
        if (gridEvent.timer < 0) {
          window.clearInterval(_countdownTimer);
          _countdownTimer = null;
          _gridManager.DisplayGrid();
          _ui.displayGridInformations(gridEvent.grid.infos);
          _ui.InfoTooltip(false, 'Bonne chance !');
        }
      }, 1000);
    } else {
      _gridManager.DisplayGrid();
      _ui.displayGridInformations(gridEvent.grid.infos);
    }
  }

  function resetGame() {
    // Stop any running countdown and hide the banner immediately
    if (_countdownTimer) { window.clearInterval(_countdownTimer); _countdownTimer = null; }
    _ui.InfoTooltip(false);
    _ui.resetGridInformations();
    _scoreManager.resetScores();
    if (_gridManager) _gridManager.resetGrid();
  }

  function setPlayerColor(color) {
    var rgb   = _ui.getRGBComponents(color),
        css   = '.focusCell { -moz-box-shadow: inset 0px 0px 30px 4px rgba(' + rgb + ',0.2);box-shadow: inset 0px 0px 30px 4px rgba(' + rgb + ',0.2);border-color: rgba(' + rgb + ',0.4); } .goRight:before, .goDown:before { color: rgb(' + rgb + '); }',
        style = document.createElement('style');
    style.type = 'text/css';
    if (style.styleSheet) style.styleSheet.cssText = css;
    else style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  // ─── Solo mode ────────────────────────────────────────────────────────────

  function startSoloMode() {
    _gameState = enumState.Solo;
    _soloScore = 0;

    _ui.ChangeGameScreen(enumPanels.Game, true);

    // Hide chat panel — not needed in solo
    document.getElementById('gs-chat').style.display = 'none';
    document.getElementById('gs-scores').innerHTML =
      '<div id="solo-score"><span class="solo-label">Score</span><span class="solo-value">0</span></div>';

    fetch('/api/grid')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (fullGrid) {
        _soloGrid    = fullGrid;
        _gridManager = new GridManager(fullGrid, validateSoloWord);
        _gridManager.DisplayGrid();
        _ui.displayGridInformations(fullGrid.infos);
      })
      .catch(function (e) {
        showError('Impossible de charger la grille solo : ' + e.message);
      });
  }

  function validateSoloWord(wordObj) {
    // fullGrid has .value on every LetterCase — validate locally
    var jump  = wordObj.axis === 0 ? 1 : _soloGrid.nbLines;
    var index = wordObj.start;
    var points = 0;
    var i;

    for (i = 0; i < wordObj.word.length; i++) {
      if (wordObj.word[i] !== _soloGrid.cases[index].value) return; // wrong letter
      if (_soloGrid.cases[index].available) points++;
      index += jump;
    }

    // Mark as solved in the shared grid object
    index = wordObj.start;
    for (i = 0; i < wordObj.word.length; i++) {
      _soloGrid.cases[index].available = false;
      index += jump;
    }
    _soloGrid.nbWords--;

    wordObj.color = '#27A096';
    _gridManager.RevealWord(wordObj);

    _soloScore += points;
    var el = document.querySelector('#solo-score .solo-value');
    if (el) el.textContent = _soloScore;

    if (_soloGrid.nbWords <= 0) {
      _ui.displayGameOver({ nick: 'Solo', monster: { path: 'images/logos/monster1.png', color: '#27A096' } });
    }
  }

  // ─── URL helpers ──────────────────────────────────────────────────────────

  function getRoomCodeFromURL() {
    var hash = window.location.hash.substring(1).toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(hash)) return hash;
    var match = window.location.search.match(/[?&]room=([A-Z0-9]{4})/i);
    if (match) return match[1].toUpperCase();
    return null;
  }

  function setURLRoomCode(roomId) {
    if (history.replaceState) {
      history.replaceState(null, '', roomId ? '#' + roomId : window.location.pathname + window.location.search);
    }
  }

  function showError(msg) {
    document.getElementById('ep-text').innerHTML = msg;
    _ui.ChangeGameScreen(enumPanels.Error, true);
  }

});
