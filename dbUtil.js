var wbDB = require('./whiteboardDB');
var fs = require('fs');
var pargs = require('minimist')(process.argv);

var printHelp = function()
{
  console.log("Stylus Labs whiteboard database utility");
  console.log("Available commands:");
  //console.log("  node dbTool.js --db <path to database file> createdb");
  console.log("  adduser <username> <password> [[<email> <displayname>]] - add new user");
  console.log("  updatepw <username> <newpassword> - change password for user");
  console.log("  rmuser <username> - delete user");
  console.log("  list - list all users");
  console.log("Arguments:");
  console.log("  --db <path to database file> (required)");
  console.log("Example:");
  console.log("  node dbUtil.js --db db1.sqlite adduser user1 passwd1");
}

if(!pargs["db"]) {
  printHelp();
  process.exit(-101);
}

if(!fs.existsSync(pargs["db"]))
  console.log("Database file " + pargs["db"] + " will be created.");

var db = wbDB.openDB(pargs["db"], function(err) {
  if(err) {
    console.log("Error opening database " + pargs["db"] + ": ", err);
    process.exit(-102);
  }
});

// copied from stylusweb app

var addNewAccount = function(newData, callback)
{
  // check for conflict
  db.get("SELECT username, email FROM users WHERE username = ? OR email = ?", newData.user, newData.email,
      function(err, row) {
    if(row) {
      callback(row.username == newData.user ? 'username-taken' : 'email-taken');
    }
    else {
      // no conflict
      var pwhash = wbDB.saltAndHash(newData.pass);
      db.run("INSERT INTO users(username, password, email, displayname) VALUES(?, ?, ?, ?)",
          newData.user, pwhash, newData.email, newData.displayname, callback);
    }
  });
}

var updatePasswordByUser = function(username, newPass, callback)
{
  var pwhash = wbDB.saltAndHash(newPass);
  db.run("UPDATE users SET password = ? WHERE username = ?", pwhash, username, callback);
}

var deleteAccountByUser = function(username, callback)
{
  db.run("DELETE FROM users WHERE username = ?", username, callback);
}


// commands
args = pargs._.slice(2);
var cmd = args[0];

if(cmd == "adduser") {
  var userData = {'user': args[1], 'pass': args[2], 'email': args[3], 'displayname': args[4]};
  addNewAccount(userData, function(e){
    if(e)
      console.log("Error adding user: ", e);
    else
      console.log("User added.");
  });
}
else if(cmd == "updatepw") {
  var user = args[1];
  var pass = args[2];
  updatePasswordByUser(user, pass, function(e){
    if(e)
      console.log("Error updating password: ", e);
    else if(!this.changes)
      console.log("User not found.");
    else
      console.log("Password updated.");
  });
}
else if(cmd == "rmuser") {
  var user = args[1];
  deleteAccountByUser(user, function(e){
    if(e)
      console.log("Error removing user: ", e);
    else
      console.log("User deleted.");
  });
}
else if(cmd == "list") {
  db.all("SELECT username FROM users", function(err, rows) {
    rows.forEach(function(row){ console.log(row.username); });
  });
}
else {
  printHelp();
}
