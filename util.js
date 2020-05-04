var crypto             = require('crypto');

exports.md5            = str => crypto.createHash('md5').update(str).digest('hex');
exports.rndstr         = ()  => (1 + Math.PI * Math.random()).toString(36).slice(2);
Array.prototype.remove = function(e) {
	for(var i = 0; i < this.length; i++) {
		if(e == this[i]) {
			return this.splice(i, 1);
		}
	}
	
	return null;
};
