var util          = require('util'),
    EventEmitter  = require('events').EventEmitter,
    Player        = require('./player'),
    enums         = require('./enums'),
    Monsters      = require('./playersLogos').Monsters;


function PlayersManager () {
  EventEmitter.call(this);
  // Instance state (not module-level variables)
  this._playersList     = [];
  this._currentPlayerId = 0;
}

util.inherits(PlayersManager, EventEmitter);

PlayersManager.prototype.addNewPlayer = function (playerSocket) {
  var newPlayer = new Player(playerSocket, this._currentPlayerId++);
  this._playersList.push(newPlayer);
  console.info('New player connected. There is currently ' + this._playersList.length + ' player(s)');
  return (newPlayer);
};

PlayersManager.prototype.removePlayer = function (player) {
  var pos = this._playersList.indexOf(player);

  if (pos < 0) {
    console.error("[ERROR] Can't find player in playerList");
  }
  else {
    console.info('Removing player ' + player.getNick());
    this._playersList.splice(pos, 1);
    console.info('It remains ' + this._playersList.length + ' player(s)');
  }
};

PlayersManager.prototype.getPlayerList = function () {
  var players = [],
      nbPlayers = this._playersList.length,
      i;

  for (i = 0; i < nbPlayers; i++) {
    players.push(this._playersList[i].getPlayerObject());
  }

  return (players);
};

PlayersManager.prototype.getNumberOfPlayers = function () {
  return (this._playersList.length);
};

PlayersManager.prototype.getAvailableMonsters = function () {
  var availableMonsters = [],
      i,
      nbLogos = Monsters.length;

  for (i = 0; i < nbLogos; i++) {
    if (Monsters[i].player == null)
      availableMonsters.push(Monsters[i]);
  }

  return (availableMonsters);
};

PlayersManager.prototype.setMonsterToPlayer = function (player, monsterId) {
  if ((monsterId > (Monsters.length - 1)) || (Monsters[monsterId].player != null)) {
    console.error('[ERROR] Monster ' + monsterId + ' seems to be unavailable');
    monsterId = 0;
    while (Monsters[monsterId].player != null)
      monsterId++;
  }

  player.setMonster(Monsters[monsterId]);
  Monsters[monsterId].player = player.getID();
};

PlayersManager.prototype.findPlayerByNick = function (nick) {
  for (var i = 0; i < this._playersList.length; i++) {
    if (this._playersList[i].getNick() === nick)
      return (this._playersList[i]);
  }
  return (null);
};

PlayersManager.prototype.getWinner = function () {
  var i,
      bestScore = 0,
      winnerIndex;

  for (i in this._playersList) {
    if (this._playersList[i].getScore() > bestScore) {
      bestScore = this._playersList[i].getScore();
      winnerIndex = i;
    }
  }

  return (this._playersList[winnerIndex]);
};

PlayersManager.prototype.resetPlayersForNewGame = function () {
  var index, i;

  for (index in this._playersList) {
    this._playersList[index].resetPlayerInfos();
  }

  // Reset all monster assignments so they become available again
  for (i = 0; i < Monsters.length; i++) {
    Monsters[i].player = null;
  }
};


module.exports = PlayersManager;
