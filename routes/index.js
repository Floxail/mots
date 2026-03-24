/*
 * GET home page.
 */
exports.index = function(req, res) {
  // Derive the server's public address from the incoming request (works locally and on cloud)
  var protocol = req.headers['x-forwarded-proto'] || req.protocol;
  var host = req.get('host');
  res.render('mfl', { title: 'MotsFleches.js', wsAddress: protocol + '://' + host });
};
