var enums           = require('./enums'),
    config          = require('../conf.json'),
    GridManager     = require('./gridManager'),
    PlayersManager  = require('./playersManager');

var MAX_PLAYERS          = 9;
var SERVER_CHAT_COLOR    = '#c0392b';
var TIME_BEFORE_START    = 5;
var ROOM_INACTIVITY_MS   = 60 * 60 * 1000; // 60 minutes before room cleanup

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateRoomId() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  var id = '';
  for (var i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// ─── GameRoom ─────────────────────────────────────────────────────────────────

function GameRoom(id, io, onInactive) {
  this.id              = id;
  this._io             = io;
  this.gridManager     = new GridManager();
  this.playersManager  = new PlayersManager();
  this.gameState       = enums.ServerState.WaitingForPlayers;
  this.lastWordFoundTs = null;
  this.gridReady       = false;
  this._foundWords     = []; // {word, axis, start, color} for replay on rejoin
  this._lastActivity   = Date.now();
  this._onInactive     = onInactive || null;
  this._inactivityTimer = null;
  this._startInactivityTimer();
}

GameRoom.prototype.touchActivity = function () {
  this._lastActivity = Date.now();
};

GameRoom.prototype._startInactivityTimer = function () {
  var self = this;
  this._inactivityTimer = setInterval(function () {
    if (Date.now() - self._lastActivity >= ROOM_INACTIVITY_MS) {
      console.log('[SERVER] Room ' + self.id + ' — closed after 60 min of inactivity');
      self.destroy();
    }
  }, 60 * 1000); // check every minute
};

GameRoom.prototype.destroy = function () {
  clearInterval(this._inactivityTimer);
  this.broadcast('room_closed');
  // Disconnect all sockets in this room
  var roomSockets = this._io.sockets.adapter.rooms.get(this.id);
  if (roomSockets) {
    roomSockets.forEach(function (socketId) {
      var s = this._io.sockets.sockets.get(socketId);
      if (s) s.disconnect(true);
    }.bind(this));
  }
  if (this._onInactive) this._onInactive(this.id);
};

GameRoom.prototype.broadcast = function (event, data) {
  this._io.to(this.id).emit(event, data);
};

GameRoom.prototype.sendChat = function (message, sender, color, playerList) {
  if (sender === undefined) { sender = 'server'; color = SERVER_CHAT_COLOR; }
  this.touchActivity();
  this.broadcast('chat', { message: message, from: sender, color: color, players: playerList });
};

GameRoom.prototype.sendToSocket = function (socket, message) {
  socket.emit('chat', { message: message, from: 'server', color: SERVER_CHAT_COLOR });
};

GameRoom.prototype.startGame = function () {
  var grid  = this.gridManager.getGrid();
  var delay = this.playersManager.getNumberOfPlayers() > 1 ? TIME_BEFORE_START : 0;
  this.gameState = enums.ServerState.OnGame;
  this.broadcast('grid_event', { grid: grid, timer: delay });
};

GameRoom.prototype.resetGame = function (gridId) {
  var self = this;
  self.gameState = enums.ServerState.WaitingForPlayers;
  self._foundWords = [];
  self.lastWordFoundTs = null;
  self.playersManager.resetPlayersForNewGame();
  self.gridManager.resetGrid(gridId, function (grid) {
    if (!grid) {
      console.error('[ERROR] Cannot retreive requested grid [' + gridId + ']');
      self.sendChat('Oups, impossible de récupérer la grille ' + gridId + ' !');
    } else {
      var infos = self.gridManager.getGridInfos();
      self.sendChat('Grille ' + infos.provider + ' ' + infos.id + ' (Niveau ' + infos.level + ') prête !');
      self.broadcast('grid_reset');
      self.startGame();
    }
  });
};

GameRoom.prototype.bonusChecker = function (playerPoints, nbWordsRemaining) {
  var bonus = { points: 0, bonusList: [] };
  var now = Date.now();

  if (this.lastWordFoundTs == null) {
    bonus.bonusList.push({ title: "Preum's !", points: 4 });
    bonus.points += 4;
  }
  if (nbWordsRemaining <= 0) {
    bonus.bonusList.push({ title: 'Finish him !', points: 4 });
    bonus.points += 4;
  }
  if ((now - this.lastWordFoundTs) > 120000) {
    bonus.bonusList.push({ title: 'Débloqueur', points: 5 });
    bonus.points += 5;
  }
  if (playerPoints >= 6) {
    bonus.bonusList.push({ title: 'Gros mot !', points: 3 });
    bonus.points += 3;
  }
  return bonus;
};

GameRoom.prototype.checkWord = function (player, wordObj) {
  this.touchActivity();
  var points = this.gridManager.checkPlayerWord(wordObj);
  if (points >= 0) {
    wordObj.color = player.getColor();
    this._foundWords.push({ word: wordObj.word, axis: wordObj.axis, start: wordObj.start, color: wordObj.color });
    this.broadcast('word_founded', wordObj);
    this.sendChat('<strong>' + player.getNick() + '</strong> a trouvé <strong>' + wordObj.word + '</strong> (+' + points + ' pts) !');

    var bonuses = this.bonusChecker(points, this.gridManager.getNbRemainingWords());
    this.lastWordFoundTs = Date.now();
    player.updateScore(points + bonuses.points);

    this.broadcast('score_update', {
      playerID: player.getID(),
      score:    player.getScore(),
      words:    player.getNbWords(),
      progress: this.gridManager.getAccomplishmentRate(player.getScore(), this.playersManager.getNumberOfPlayers()),
      bonus:    bonuses.bonusList
    });

    if (this.gridManager.getNbRemainingWords() <= 0) {
      console.log('[SERVER] Room ' + this.id + ' — game over!');
      this.broadcast('game_over', this.playersManager.getWinner().getPlayerObject());
    }
  }
};

// Send full game state to a (re)joining socket: grid, found words, all scores
GameRoom.prototype.sendGameState = function (socket, player) {
  socket.emit('grid_event', { grid: this.gridManager.getGrid(), timer: 0 });
  if (this._foundWords.length > 0) {
    socket.emit('found_words', this._foundWords);
  }
  // Send score_update for every player so the panel is fully populated
  var players = this.playersManager.getPlayerList();
  var nbPlayers = this.playersManager.getNumberOfPlayers();
  for (var i = 0; i < players.length; i++) {
    socket.emit('score_update', {
      playerID: players[i].id,
      score:    players[i].score,
      words:    players[i].nbWords,
      progress: this.gridManager.getAccomplishmentRate(players[i].score, nbPlayers),
      bonus:    []
    });
  }
};

GameRoom.prototype.checkServerCommand = function (message) {
  if (message[0] !== '!') return false;
  if (this.gameState === enums.ServerState.WaitingForPlayers && message === '!start') {
    this.startGame();
    return true;
  }
  if (message.indexOf('!grid') === 0) {
    var number = parseInt(message.substr(6));
    this.resetGame(isNaN(number) ? 0 : number);
    return true;
  }
  return false;
};

GameRoom.prototype.playerLog = function (socket, nick, monsterId) {
  var self   = this;
  var player = socket.playerInstance;
  if (!player) { console.error('No PlayerInstance on socket'); return; }

  var gridInfos = this.gridManager.getGridInfos();
  player.setNick(nick);
  this.playersManager.setMonsterToPlayer(player, monsterId);

  // Refresh available monsters for everyone in this room
  this.broadcast('logos', this.playersManager.getAvailableMonsters());

  // Bind word validation for this player
  socket.on('wordValidation', function (wordObj) {
    if (!wordObj || typeof wordObj.word !== 'string' || typeof wordObj.start !== 'number') return;
    if (wordObj.axis !== 0 && wordObj.axis !== 1) return;
    if (wordObj.word.length === 0 || wordObj.word.length > 50) return;
    self.checkWord(player, wordObj);
  });

  this.sendChat(
    nick + ' a rejoint la partie !<br/>' + this.playersManager.getNumberOfPlayers() + ' joueurs connectés',
    undefined, undefined,
    this.playersManager.getPlayerList()
  );
  this.sendToSocket(socket, 'Grille actuelle : ' + gridInfos.provider + ' ' + gridInfos.id + ' (Niveau ' + gridInfos.level + ')');
};


// ─── Server entry point ───────────────────────────────────────────────────────

exports.startMflServer = function (desiredGrid, httpServer) {
  var { Server } = require('socket.io');
  var io = new Server(httpServer, { cors: { origin: '*' } });

  var rooms = new Map(); // roomId → GameRoom

  // ── Helpers ──

  function getRoomList() {
    var list = [];
    rooms.forEach(function (room) {
      list.push({
        id:          room.id,
        playerCount: room.playersManager.getNumberOfPlayers(),
        gameState:   room.gameState,
        gridReady:   room.gridReady,
        gridInfo:    room.gridReady ? room.gridManager.getGridInfos() : null
      });
    });
    return list;
  }

  function broadcastRoomList() {
    io.emit('roomList', getRoomList());
  }

  // ── Per-socket game logic ──

  function bindChatHandler(socket, room) {
    socket.on('chat', function (message) {
      if (typeof message !== 'string') return;
      message = message.trim().substring(0, 200);
      if (!message) return;
      if (room.checkServerCommand(message) === false) {
        var p = socket.playerInstance;
        if (p) room.sendChat(message, p.getNick(), p.getColor());
      }
    });
  }

  function bindWordHandler(socket, room, player) {
    socket.on('wordValidation', function (wordObj) {
      if (!wordObj || typeof wordObj.word !== 'string' || typeof wordObj.start !== 'number') return;
      if (wordObj.axis !== 0 && wordObj.axis !== 1) return;
      if (wordObj.word.length === 0 || wordObj.word.length > 50) return;
      room.checkWord(player, wordObj);
    });
  }

  function registerPlayerInRoom(socket, room) {
    room.touchActivity();
    var isWaiting   = room.gameState === enums.ServerState.WaitingForPlayers;
    var hasSlot     = room.playersManager.getNumberOfPlayers() < MAX_PLAYERS;

    // ── Normal pre-game join ──
    if (isWaiting && hasSlot) {
      var player = room.playersManager.addNewPlayer(socket);
      socket.playerInstance = player;

      socket.on('disconnect', function () {
        var p = socket.playerInstance;
        if (!p) return;
        if (room.gameState === enums.ServerState.WaitingForPlayers) {
          room.sendChat(p.getNick() + ' a quitté la partie');
          room.playersManager.removePlayer(p);
          if (room.playersManager.getNumberOfPlayers() === 0) {
            clearInterval(room._inactivityTimer);
            rooms.delete(room.id);
          }
        } else {
          room.sendChat(p.getNick() + ' s\'est déconnecté (peut revenir avec le même pseudo)');
        }
        broadcastRoomList();
      });

      socket.on('userIsReady', function (infos) {
        if (!infos || typeof infos.nick !== 'string') return;
        var nick = infos.nick.trim().substring(0, 20);
        if (!nick) return;

        if (room.gameState === enums.ServerState.WaitingForPlayers) {
          room.playerLog(socket, nick, infos.monster);
          broadcastRoomList();
        } else {
          // Started while player was on login screen
          var rejoiner = room.playersManager.findPlayerByNick(nick);
          if (rejoiner) {
            rejoiner.updateSocket(socket);
            socket.playerInstance = rejoiner;
            room.sendChat('<strong>' + nick + '</strong> a rejoint la partie !', undefined, undefined, room.playersManager.getPlayerList());
            room.sendGameState(socket, rejoiner);
          } else {
            socket.emit('game_already_started');
            socket.disconnect(true);
          }
        }
      });

      bindChatHandler(socket, room);
      socket.emit('logos', room.playersManager.getAvailableMonsters());

    // ── Game already in progress — allow rejoin or late join ──
    } else {
      socket.emit('logos', hasSlot ? room.playersManager.getAvailableMonsters() : null);

      socket.once('userIsReady', function (infos) {
        if (!infos || typeof infos.nick !== 'string') return;
        var nick = infos.nick.trim().substring(0, 20);
        if (!nick) return;

        var rejoiner = room.playersManager.findPlayerByNick(nick);

        if (rejoiner) {
          // Reconnect existing player
          rejoiner.updateSocket(socket);
          socket.playerInstance = rejoiner;
          room.sendChat('<strong>' + nick + '</strong> a rejoint la partie !', undefined, undefined, room.playersManager.getPlayerList());
          room.sendGameState(socket, rejoiner);
          bindChatHandler(socket, room);
          bindWordHandler(socket, room, rejoiner);

        } else if (room.playersManager.getNumberOfPlayers() < MAX_PLAYERS) {
          // New player joining a game already underway
          var player = room.playersManager.addNewPlayer(socket);
          socket.playerInstance = player;
          room.playerLog(socket, nick, infos.monster);
          room.sendGameState(socket, player);
          bindChatHandler(socket, room);
          broadcastRoomList();

        } else {
          socket.emit('game_already_started');
        }
      });
    }
  }

  // ── Socket.IO connection handler ──

  io.on('connection', function (socket) {
    // Immediately send current room list so the lobby can populate
    socket.emit('roomList', getRoomList());

    socket.on('createRoom', function (options) {
      var roomId = generateRoomId();
      while (rooms.has(roomId)) roomId = generateRoomId();

      var room = new GameRoom(roomId, io, function (id) {
        rooms.delete(id);
        broadcastRoomList();
      });
      rooms.set(roomId, room);

      var gridNum = (options && options.gridNumber !== undefined && !isNaN(parseInt(options.gridNumber)))
        ? parseInt(options.gridNumber) : (desiredGrid || 0);

      room.gridManager.retreiveAndParseGrid(gridNum, function (grid) {
        if (!grid) {
          socket.emit('roomError', 'Impossible de charger la grille');
          rooms.delete(roomId);
          broadcastRoomList();
          return;
        }
        room.gridReady = true;
        broadcastRoomList();
      });

      socket.join(roomId);
      socket.roomId = roomId;
      socket.emit('roomJoined', { roomId: roomId });
      registerPlayerInRoom(socket, room);
      broadcastRoomList();
    });

    socket.on('joinRoom', function (roomId) {
      if (typeof roomId !== 'string') return;
      roomId = roomId.toUpperCase().trim().substring(0, 8);
      var room = rooms.get(roomId);
      if (!room) {
        socket.emit('roomError', 'Salle "' + roomId + '" introuvable');
        return;
      }
      socket.join(roomId);
      socket.roomId = roomId;
      socket.emit('roomJoined', { roomId: roomId });
      registerPlayerInRoom(socket, room);
    });

    socket.on('getRoomList', function () {
      socket.emit('roomList', getRoomList());
    });
  });

  console.log('Game server started — waiting for connections.');
};
