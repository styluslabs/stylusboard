var crypto = require('crypto');

exports.md5 = function(str)
{
  return crypto.createHash('md5').update(str).digest('hex');
}

exports.rndstr = function()
{
  return (1 + Math.PI * Math.random()).toString(36).slice(2);
}

exports.mergeHash = function(dest, src)
{
  for (var p in src) {
    if (src.hasOwnProperty(p)) {
      dest[p] = src[p];
    }
  }
  return dest;
};

Array.prototype.remove = function(e)
{
  for (var i = 0; i < this.length; i++) {
    if (e == this[i]) { return this.splice(i, 1); }
  }
  return null;
};
