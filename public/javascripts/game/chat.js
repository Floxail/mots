/*
*   The Chat class manage chat component, sending and receving messages between player
*   and server notifications
*/
define(function () {

  var _socket = null,
      _notifyCallback,
      _chatHandler = null,
      _localCommandCallback = null,
      _soloMode = false,
      _mesNode = document.getElementById('gsc-messages'),
      _writeNode = document.getElementById('gsc-write'),
      _serverColor = null;

  function Chat (socket, notifyPlayerListCallback, localCommandCallback, gridRange, localRange, soloMode) {
    // Store usefull object and callback
    _notifyCallback = notifyPlayerListCallback;
    _localCommandCallback = localCommandCallback || null;
    _soloMode = soloMode === true;

    // Remove previous chat listener if any (prevents duplicates on reconnect)
    if (_socket && _chatHandler) {
      _socket.off('chat', _chatHandler);
    }
    _socket = socket;

    // In solo there is no room, so no server chat to listen to.
    if (!_soloMode && _socket) {
      _chatHandler = function (messageObj) {
        treatChatMessage(messageObj);
      };
      _socket.on('chat', _chatHandler);
    }

    // Bind onkeyPress of the textarea node to send messages
    _writeNode.onkeypress = function (event) {

      // If the user press enter, send message
      if (event.keyCode == 13) {
        var msg = _writeNode.value.trim();
        if (msg === '!clear' && _localCommandCallback) {
          _localCommandCallback('clear');
        } else if (msg === '!info') {
          var infoBox = document.createElement('article');
          infoBox.classList.add('server-message');
          infoBox.style.color = '#7fb3c8';
          infoBox.innerHTML = '<strong>Commandes disponibles :</strong><br>'
            + '<code>!start</code> — Lance la partie (salle d\'attente)<br>'
            + '<code>!grid L[N]</code> — Lance une grille Large 15x15'
            + (localRange ? ' · Disponibles : ' + localRange : ' · aucune pour l\'instant') + '<br>'
            + '<code>!grid [N]</code> — Change de grille (vote si partie en cours)'
            + (gridRange ? ' · Grilles disponibles : ' + gridRange : '') + '<br>'
            + '<code>!oui</code> / <code>!non</code> — Vote pour/contre !grid<br>'
            + '<code>!kick pseudo</code> — Expulse un joueur inactif (10 min)<br>'
            + '<code>!quit</code> — Quitter la salle<br>'
            + '<code>!clear</code> — Efface tes lettres non validées<br>'
            + '<code>!info</code> — Affiche cette aide';
          _mesNode.appendChild(infoBox);
          _mesNode.scrollTop = _mesNode.scrollHeight;
        } else if (_soloMode) {
          // Solo has no room to broadcast to: commands run locally and plain
          // talk has no audience, so say so rather than swallowing the message.
          if (msg.indexOf('!') === 0) {
            if (_localCommandCallback) _localCommandCallback(msg);
          } else if (msg !== '') {
            Chat.prototype.print('En solo, seules les commandes fonctionnent (<code>!info</code> pour la liste).');
          }
        } else if (msg !== '') {
          _socket.emit('chat', _writeNode.value);
        }
        _writeNode.value = '';
        return (false);
      }

    };

  };

  /* Private functions */
  /*
  * On server message receive
  * @param: {Object}  msg   The server message object
  */
  function treatChatMessage(msg) {
    var box = document.createElement('article');

    if (msg.from == 'server') {
      box.classList.add('server-message');
      box.style.color = msg.color;
      _serverColor = msg.color;
      box.innerHTML = msg.message;

      // If we received a brand new player list, notify mflEngine
      if (msg.players)
        _notifyCallback(msg.players);
    }
    else {
      box.innerHTML = '<strong style="color: ' + msg.color + ';">' + msg.from + '</strong>' + msg.message;
    }

    // Add message in panel and scroll to the bottom
    _mesNode.appendChild(box);
    _mesNode.scrollTop = _mesNode.scrollHeight;
  }


  /*
  * Print a server-styled message straight into the panel, without a round
  * trip. Solo mode has no server to echo commands back, and the in-chat help
  * needs it too.
  * @param {String}  html  message content
  */
  Chat.prototype.print = function (html) {
    var box = document.createElement('article');
    box.classList.add('server-message');
    box.style.color = _serverColor || '#7fb3c8';
    box.innerHTML = html;
    _mesNode.appendChild(box);
    _mesNode.scrollTop = _mesNode.scrollHeight;
  };

  /*
  * Print a congrats message in chat !
  * @param {Object}  winner  PLayer object of the winner of the game
  */
  Chat.prototype.congrats = function (winner) {
    var box = document.createElement('article');

    // Set box style
    box.style.color = _serverColor;
    box.classList.add('server-message');

    // Create message
    box.innerHTML = 'Partie terminée.<br/>Félicitations à <strong style="display: inline; color: ' + winner.monster.color + ';">' + winner.nick + '</strong> pour sa victoire !';
    
    // Add message in panel and scroll to the bottom
    _mesNode.appendChild(box);
    _mesNode.scrollTop = _mesNode.scrollHeight;
  };

  return (Chat);

});