var enums           = require('./enums'),
    config          = require('../conf.json'),
    GridManager     = require('./gridManager'),
    PlayersManager  = require('./playersManager');

// Defines
var MAX_PLAYERS   = 4;
var SERVER_CHAT_COLOR = '#c0392b';
var TIME_BEFORE_START = 5;

// Parameters
var _playersManager,
    _gridManager,
    _io,
    _gameState,
    _lastWordFoudTimestamp;

function startGame() {
  var Grid  = _gridManager.getGrid(),
      delay;

  delay = (_playersManager.getNumberOfPlayers() > 1) ? TIME_BEFORE_START : 0;

  // Change game state
  _gameState = enums.ServerState.OnGame;

  // Send grid to clients
  _io.sockets.emit('grid_event', { grid: Grid, timer: delay } );
}

function resetGame(gridID) {
  var infos;

  // Reset game state
  _gameState = enums.ServerState.WaitingForPlayers;

  // Reset players
  _playersManager.resetPlayersForNewGame();

  // Reset the grid
  _gridManager.resetGrid(gridID, function (grid) {
    if (grid == null) {
      // If an error occurs, exit
      console.error('[ERROR] Cannot retreive requested grid [' + gridID + ']');
      sendChatMessage('Oups, impossible de récupérer la grille ' + gridID + '!');
    }
    else {
      infos = _gridManager.getGridInfos();
      sendChatMessage('Grille ' + infos.provider + ' ' + infos.id + ' (Niveau ' + infos.level + ') prête !');

      // Send reset order to clients, then start game automatically
      _io.sockets.emit('grid_reset');
      startGame();
    }
  });
}

function playerLog (socket, nick, monsterId) {
  var gridInfos = _gridManager.getGridInfos();
  var player = socket.playerInstance;

  if (!player) {
    console.error('No PlayerInstance on socket');
    return;
  }

  // Set new player parameters
  player.setNick(nick);
  _playersManager.setMonsterToPlayer(player, monsterId);
  // Refresh monster list for unready players
  _io.sockets.emit('logos', _playersManager.getAvailableMonsters());

  // Bind found word event
  socket.on('wordValidation', function (wordObj) {
    // Validate word object structure
    if (!wordObj || typeof wordObj.word !== 'string' || typeof wordObj.start !== 'number' || (wordObj.axis !== 0 && wordObj.axis !== 1)) return;
    if (wordObj.word.length === 0 || wordObj.word.length > 50) return;
    checkWord(player, wordObj);
  });

  // Notify everyone about the new client
  sendChatMessage( nick + ' a rejoint la partie !<br/>' + _playersManager.getNumberOfPlayers() + ' joueurs connectés', undefined, undefined, _playersManager.getPlayerList());

  // Send grid informations to the player
  sendPlayerMessage(socket, 'Grille actuelle: ' + gridInfos.provider + ' ' + gridInfos.id + ' (Niveau ' + gridInfos.level + ')');
}

function bonusChecker(playerPoints, nbWordsRemaining) {
  var bonus = {
    points: 0,
    bonusList: []
  },
  now = new Date().getTime();

  // If it's the first word, add 4 bonus points
  if (_lastWordFoudTimestamp == null) {
    bonus.bonusList.push( { title: "Preum's !", points: 4 } );
    bonus.points += 4;
  }

  // If it's the last word
  if (nbWordsRemaining <= 0) {
    bonus.bonusList.push( { title: 'Finish him !', points: 4 } );
    bonus.points += 4;
  }

  // If it's the first word since the last 2 minutes, 5 points
  if ((now - _lastWordFoudTimestamp) > 120000) {
    bonus.bonusList.push( { title: 'Débloqueur', points: 5 } );
    bonus.points += 5;
  }

  // If it's a big word, add 3 points
  if (playerPoints >= 6) {
    bonus.bonusList.push( { title: 'Gros mot !', points: 3 } );
    bonus.points += 3;
  }

  return (bonus);
}

function checkWord(player, wordObj) {
  var points,
      bonuses;

  // Check word
  points = _gridManager.checkPlayerWord(wordObj);

  // If the players has some points, it's mean it's the right word ! Notify players about it
  if (points >= 0) {

    // Notify all clients about this word
    wordObj.color = player.getColor();
    _io.sockets.emit('word_founded', wordObj);

    // Notify chat about the found word
    sendChatMessage('<strong>' + player.getNick() + '</strong> a trouvé <strong>' + wordObj.word + '</strong> (+' + points + ' pts) !');

    // Check for bonuses
    bonuses = bonusChecker(points, _gridManager.getNbRemainingWords());

    // Remember time this last word had been found
    _lastWordFoudTimestamp = new Date().getTime();

    // Update player score and notify clients
    player.updateScore(points + bonuses.points);
    _io.sockets.emit('score_update', { playerID: player.getID(), score: player.getScore(), words: player.getNbWords(), progress: _gridManager.getAccomplishmentRate(player.getScore(), _playersManager.getNumberOfPlayers()), bonus: bonuses.bonusList } );

    if (_gridManager.getNbRemainingWords() <= 0) {
      console.log('[SERVER] Game over ! Sending player\'s notification...');
      _io.sockets.emit('game_over', _playersManager.getWinner().getPlayerObject());
    }
  }
}

function checkServerCommand(message) {
  var number;

  // If it's not a server command
  if (message[0] != '!')
    return (false);

  // Check the start command
  if ((_gameState == enums.ServerState.WaitingForPlayers) && (message == '!start')) {
    startGame();
    return (true);
  }

  // Check the change grid command
  if (message.indexOf('!grid') >= 0) {
    // Retreive grid number and reset game parameters
    number = parseInt(message.substr(6));
    resetGame(number);
    return (true);
  }

  return (false);
}

function sendChatMessage(Message, sender, color, playerList) {
  if (sender === undefined) {
    sender = 'server';
    color = SERVER_CHAT_COLOR;
  }

  _io.sockets.emit('chat', { message: Message, from: sender, color: color, players: playerList } );
}

function sendPlayerMessage(socket, Message) {
  socket.emit('chat', { message: Message, from: 'server', color: SERVER_CHAT_COLOR });
}


/**
 *  Start mfl server.
 */
exports.startMflServer = function (desiredGrid, httpServer) {
  // Instanciate io module with proper parameters
  var { Server } = require('socket.io');
  _io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  // Retreive the grid
  _gridManager = new GridManager();
  _gridManager.retreiveAndParseGrid(desiredGrid, function (grid) {
    if (grid == null) {
      // If an error occurs, exit
      console.error('[ERROR] Cannot retreive grid. Abort server.');
      process.exit(1);
    }
  });

  // Create playersManager instance and register events
  _playersManager = new PlayersManager();
  _playersManager.on('players-ready', function () {
  });


  // On new client connection
  _io.sockets.on('connection', function (socket) {

    // If it remains slots in the room, add player and bind events
    if ((_gameState == enums.ServerState.WaitingForPlayers) && (_playersManager.getNumberOfPlayers() < MAX_PLAYERS)) {

      // Add new player
      var player = _playersManager.addNewPlayer(socket);

      // Store player instance directly on the socket
      socket.playerInstance = player;

      // Register to socket events
      socket.on('disconnect', function () {
        var player = socket.playerInstance;
        if (player) {
          // Only remove from list if game hasn't started (allow rejoin during game)
          if (_gameState == enums.ServerState.WaitingForPlayers) {
            sendChatMessage( player.getNick() + ' a quitté la partie');
            _playersManager.removePlayer(player);
          } else {
            sendChatMessage( player.getNick() + ' s\'est déconnecté (peut revenir avec le même pseudo)');
          }
        }
      });

      socket.on('userIsReady', function (infos) {
        // Validate nick
        if (!infos || typeof infos.nick !== 'string') return;
        var nick = infos.nick.trim().substring(0, 20);
        if (nick.length === 0) return;

        if (_gameState == enums.ServerState.WaitingForPlayers) {
          // Normal lobby join
          playerLog(socket, nick, infos.monster);
        } else {
          // Game in progress — check if this nick belongs to a disconnected player
          var rejoiningPlayer = _playersManager.findPlayerByNick(nick);
          if (rejoiningPlayer) {
            rejoiningPlayer.updateSocket(socket);
            socket.playerInstance = rejoiningPlayer;
            // Send player list in chat so client rebuilds the score panel first
            sendChatMessage('<strong>' + nick + '</strong> a rejoint la partie !', undefined, undefined, _playersManager.getPlayerList());
            // Resend current grid state and score after the chat (client processes events in order)
            socket.emit('grid_event', { grid: _gridManager.getGrid(), timer: 0 });
            socket.emit('score_update', { playerID: rejoiningPlayer.getID(), score: rejoiningPlayer.getScore(), words: rejoiningPlayer.getNbWords(), progress: _gridManager.getAccomplishmentRate(rejoiningPlayer.getScore(), _playersManager.getNumberOfPlayers()), bonus: [] });
          } else {
            // No matching player — game is full/started
            socket.emit('game_already_started');
            socket.disconnect(true);
          }
        }
      });

      socket.on('chat', function (message) {
        // Validate message
        if (typeof message !== 'string') return;
        message = message.trim().substring(0, 200);
        if (message.length === 0) return;

        // If it's a message for the server, treat it
        // Else broadcast the message to everyone
        if (checkServerCommand(message) == false) {
          var player = socket.playerInstance;
          if (player)
            sendChatMessage(message, player.getNick(), player.getColor());
        }
      });

      // Send to the player availables logos
      socket.emit('logos', _playersManager.getAvailableMonsters());
    }
    // Else: game in progress — tell client logos are unavailable, but listen for rejoin attempt
    else {
      socket.emit('logos', null);

      socket.once('userIsReady', function (infos) {
        if (!infos || typeof infos.nick !== 'string') return;
        var nick = infos.nick.trim().substring(0, 20);
        if (nick.length === 0) return;

        var rejoiningPlayer = _playersManager.findPlayerByNick(nick);
        if (rejoiningPlayer) {
          rejoiningPlayer.updateSocket(socket);
          socket.playerInstance = rejoiningPlayer;
          // Send player list in chat so client rebuilds the score panel first
          sendChatMessage('<strong>' + nick + '</strong> a rejoint la partie !', undefined, undefined, _playersManager.getPlayerList());
          socket.emit('grid_event', { grid: _gridManager.getGrid(), timer: 0 });
          socket.emit('score_update', { playerID: rejoiningPlayer.getID(), score: rejoiningPlayer.getScore(), words: rejoiningPlayer.getNbWords(), progress: _gridManager.getAccomplishmentRate(rejoiningPlayer.getScore(), _playersManager.getNumberOfPlayers()), bonus: [] });

          socket.on('chat', function (message) {
            if (typeof message !== 'string') return;
            message = message.trim().substring(0, 200);
            if (message.length === 0) return;
            if (checkServerCommand(message) == false) {
              var p = socket.playerInstance;
              if (p) sendChatMessage(message, p.getNick(), p.getColor());
            }
          });
          socket.on('wordValidation', function (wordObj) {
            if (!wordObj || typeof wordObj.word !== 'string' || typeof wordObj.start !== 'number' || (wordObj.axis !== 0 && wordObj.axis !== 1)) return;
            if (wordObj.word.length === 0 || wordObj.word.length > 50) return;
            checkWord(rejoiningPlayer, wordObj);
          });
        } else {
          socket.emit('game_already_started');
        }
      });
    }

  });


  // Set game state and print ready message
  _gameState = enums.ServerState.WaitingForPlayers;
  console.log('Game started and waiting for players.');
};
