function extractDefinitions(body) {
  var marker = 'id="definitions"';
  var idx = body.indexOf(marker);
  if (idx === -1) return [];

  var section = body.slice(idx, idx + 8000);
  var endIdx = section.indexOf('</div></div>');
  if (endIdx !== -1) section = section.slice(0, endIdx);

  var re = /itemprop='text'>([^<]+)<\/span>/g;
  var defs = [];
  var m;
  while ((m = re.exec(section)) !== null) {
    defs.push(m[1].trim());
  }
  return defs;
}

module.exports = { extractDefinitions: extractDefinitions };
