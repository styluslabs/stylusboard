var sqlite3    = require('sqlite3');  //.verbose() - for enabling full stack traces on error
var util       = require('./util');
var md5        = util.md5;

exports.openDB = function(path, callback) {
	var db = new sqlite3.Database(path, callback);
	
	db.exec(
	 "CREATE TABLE IF NOT EXISTS users( \
			id INTEGER PRIMARY KEY, \
			username TEXT, \
			password TEXT, \
			email TEXT, \
			displayname TEXT); \
		CREATE INDEX IF NOT EXISTS username_index ON users(username);"
	);
	// don't bother creating index on email since it is only used for lost password lookups
	//CREATE INDEX IF NOT EXISTS email_index ON users(email);
	//db.run("INSERT OR IGNORE INTO users(id, username, password, email, displayname) VALUES(1, 'user1', ?, 'user1@styluslabs.com', 'User 1');",
	//    crypto.createHash("md5").update("pw1").digest("hex"));
	//db.run("INSERT OR IGNORE INTO users(id, username, password, email, displayname) VALUES(2, 'user2', ?, 'user2@styluslabs.com', 'User 2');",
	//    crypto.createHash("md5").update("pw2").digest("hex"));
	return db;
}

// password handling

var randSalt = function(len) {
	var set  = '0123456789abcdefghijklmnopqurstuvwxyzABCDEFGHIJKLMNOPQURSTUVWXYZ';
	var salt = '';
	
	for(var i = 0; i < len; i++) {
		var p = Math.floor(Math.random() * set.length);
		salt += set[p];
	}
	
	return salt;
}

exports.saltAndHash = function(pass) {
	// this fixed salt must match value used in app
	var salt = "styluslabs"; // randSalt(10);
	
	return md5(salt + pass);  //salt + md5(salt + pass);
}

exports.validatePassword = function(candidatePass, hashedPass) {
	//var salt = hashedPass.substr(0, 10);
	//var candidateHash = salt + md5(salt + candidatePass);
	var salt          = "styluslabs";
	var candidateHash = md5(salt + candidatePass);
	
	return hashedPass === candidateHash;
}

// app sends md5(md5(salt + pass) + challenge)
exports.validateAppLogin = function(candidateHash, challenge, hashedPass) {
	var validHash          = md5(hashedPass + challenge);
	
	return candidateHash === validHash;
}
