/**
 * Module dependencies.
 */
var express = require('express'),
    routes  = require('./routes'),
    http    = require('http'),
    path    = require('path'),
    os      = require('os'),
    prompts = require('prompts'),
    app     = express(),
    config  = require('./conf.json'),
    mfl     = require('./game_files/motsFleches'),

    _gridNumber = 0;


// all environments
var _port = process.env.PORT || config.SERVER_PORT;
app.set('port', _port);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', routes.index);

// Solo mode — returns full grid (letters included) for client-side word validation
app.get('/api/grid/:number?', function (req, res) {
  var GridManager = require('./game_files/gridManager');
  var gm = new GridManager();
  var number = req.params.number ? parseInt(req.params.number) : 0;
  if (isNaN(number)) number = 0;
  gm.retreiveAndParseGrid(number, function (grid) {
    if (!grid) return res.status(500).json({ error: 'Impossible de charger la grille' });
    res.json(gm.getFullGrid());
  });
});
app.get('/conf.json', function(req, res) {
    var protocol = req.headers['x-forwarded-proto'] || req.protocol;
    var host = req.get('host');
    var parts = host.split(':');
    var hostname = parts[0];
    var port = parts[1] ? parseInt(parts[1]) : (protocol === 'https' ? 443 : 80);
    res.json(Object.assign({}, config, {
        SOCKET_ADDR: protocol + '://' + hostname,
        SOCKET_PORT: port
    }));
});

// Create HTTP server (Socket.IO will attach to it too — single port)
var _server = http.createServer(app);
_server.listen(_port, onServerReady);

// Retreive command line arguments
if (process.argv[2]) {
  // If the user wants the default grid (debug purpose)
  if ((isNaN(process.argv[2])) && (process.argv[2].toLowerCase() == 'default'))
    _gridNumber = -1;
  // Else if the user try to retreive a special grid
  else if (!isNaN(process.argv[2]))
    _gridNumber = process.argv[2];
}

/** Call when the express server has started */
async function onServerReady() {
  console.log('Express server listening on port ' + _port);

  var addresses = getLocalIpAddresses();

  if (addresses.length === 0) {
    // Cloud environment — no local interfaces, URL is derived from request headers
    console.log('\n\n\tGame server ready (cloud mode)\n\n');
  }
  else if (addresses.length > 1) {
    if (process.stdin.isTTY) {
      var response = await prompts({
        type: 'select',
        name: 'value',
        message: 'Choose the IP address to use',
        choices: addresses,
      });
      console.log(`\n\n\tWaiting for players at http://${addresses[response.value]}:${_port}\n\n`);
    } else {
      console.log(`\n\n\tWaiting for players at http://${addresses[0]}:${_port}\n\n`);
    }
  }
  else {
    console.log(`\n\n\tWaiting for players at http://${addresses[0]}:${_port}\n\n`);
  }

  // Load desired grid in parameter.
  // -1 to retreive the day grid, 0 for the default one or any number for a special one
  mfl.startMflServer(_gridNumber, _server);
}

/** Get local ip addresses */
function getLocalIpAddresses() {
  var ifaces = os.networkInterfaces();
  var addresses = [];

  Object.keys(ifaces).map(function (ifname) {
    return ifaces[ifname].map(function (iface) {
      if (iface.family !== 'IPv4' || iface.internal !== false) return;
      addresses.push(iface.address);
    });
  });

  return addresses;
}
