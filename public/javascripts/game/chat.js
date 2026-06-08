/*
*   The Chat class manage chat component, sending and receving messages between player
*   and server notifications
*/
define(function () {

  var _socket = null,
      _notifyCallback,
      _chatHandler = null,
      _localCommandCallback = null,
      _mesNode = document.getElementById('gsc-messages'),
      _writeNode = document.getElementById('gsc-write'),
      _serverColor = null;

  function Chat (socket, notifyPlayerListCallback, localCommandCallback) {
    // Store usefull object and callback
    _notifyCallback = notifyPlayerListCallback;
    _localCommandCallback = localCommandCallback || null;

    // Remove previous chat listener if any (prevents duplicates on reconnect)
    if (_socket && _chatHandler) {
      _socket.off('chat', _chatHandler);
    }
    _socket = socket;

    // On init, bind socket to receive messages
    _chatHandler = function (messageObj) {
      treatChatMessage(messageObj);
    };
    _socket.on('chat', _chatHandler);

    // Bind onkeyPress of the textarea node to send messages
    _writeNode.onkeypress = function (event) {

      // If the user press enter, send message
      if (event.keyCode == 13) {
        var msg = _writeNode.value.trim();
        if (msg === '!clear' && _localCommandCallback) {
          _localCommandCallback('clear');
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