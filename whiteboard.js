// insert `debugger;` and run `node debug sync1.js` for basic debugging
// use https://github.com/node-inspector/node-inspector for advanced debugging
// JXCore packaging: jx package whiteboard.js stylusboard -native

// example: node whiteboard.js --db=/home/mwhite/cloud/stylusdata/cloudwrite.sqlite --log-level=debug --log-path="/var/log/styluslabs"

var net    = require("net");
var http   = require("http");
var url    = require("url");
var moment = require('moment');

var logger = require('./logger');
var util   = require('./util');
var md5    = util.md5;
var rndstr = util.rndstr;

// handle command line args - don't remove leading items since the number can vary based on how we're started
var pargs  = require('minimist')(process.argv);  //.slice(2));

// handle optional JSON config file (specified as command line arg)
/* {
	"db": "/home/mwhite/stylusdata/cloudwrite.sqlite",
	"log-level": "debug",
	"log-path": null,
	"allow-anon": true,
} */
// note that command line args override config-file
if(pargs["config-file"]) {
	var fs = require('fs');
	pargs  = Object.assign(JSON.parse(fs.readFileSync(pargs["config-file"])), pargs);
}

// DB setup
var db = false;
if(pargs["db"]) {
	var wbDB = require('./whiteboardDB');
	db       = wbDB.openDB(pargs["db"], function(err) {
		if(err) {
			console.log("Error opening database " + pargs["db"] + ": ", err);
			process.exit(-102);
		} else {
			db.get("SELECT COUNT(1) AS nusers FROM users;", function(err, row) {
				if(row) {
					console.log("Database loaded with " + row.nusers + " users.");
				}
			});
		}
	});
} else {
	console.log("No database specified: running in anonymous mode.");
}

// Use HTTP API on separate port for everything except actual SWB
// - for now, let's go with a default of short random string id:
//  1. authenticate; reprompt for credentials on failure
//  2. request random session id from server
//  3. show share doc box with session id, allowing user to change id to something meaningful
//  4. request new shared session from server; if session already exists, prompt user to connect to existing session
//   - must prompt so user isn't surprised to see the doc they are looking at be replaced
// - future options include:
//  - session password to provide security while allowing session name to be meaningful
//  - option to restrict access to users within the same organization (as specified at sign up)
//  - option to restrict access to specified list of users
//  - full URL as session ID for easy web access to sessions or site installs of server

function Client(stream) {
	this.name          = null;
	this.stream        = stream;
	this.remote        = stream.remoteAddress + ":" + stream.remotePort;
	this.cmdstr        = "";
	this.tempdata      = "";
	this.expectdatalen = 0;
}

function Whiteboard(repo, attribs, token) {
	this.repo    = repo;
	this.token   = token;
	this.attribs = attribs;
	this.clients = [];
	this.history = "";
}

var whiteboards = {};

// HTTP API server

function Session(user, token) {
	this.user  = user;
	this.token = token;
	this.ctime = Date.now();
}

var sessions = {};

var apilog = logger('apilog');
apilog.setLogLevel(pargs["log-level"] || process.env.STYLUS_LOG_LEVEL || 'info');
//process.env.STYLUS_LOG_PATH && apilog.setLogFile(process.env.STYLUS_LOG_PATH + "/apiserver.log");
pargs["log-path"] && apilog.setLogFile(pargs["log-path"] + "/apiserver.log");


var apiserver = http.createServer(function(request, response) {
	var parsed  = url.parse(request.url, true);  // parseQueryString = true
	var path    = parsed.pathname;
	var args    = parsed.query;
	// extract cookies
	var cookies = {};
	request.headers['cookie'] && request.headers['cookie'].split(';').forEach(function(cookie) {
		var parts                = cookie.split('=');
		cookies[parts[0].trim()] = (parts[1] || "").trim();
	});
	// logging
	response.addListener('finish', function() {
		apilog.info(request.socket.remoteAddress + ' - [' + moment().utc().format('DD MMMM YYYY HH:mm:ss') + ' GMT] "' + request.method + ' ' + request.url + '" ' + response.statusCode + ' - ' + request.headers['user-agent'] + '"');
	});
	
	// debug page
	if(path == "/v1/debug" && pargs["enable-test"]) { //&& args["secret"] == "123456") {
		var replacer = function (key, value) {
			if(key == "history" || key == "tempdata")
				return "[ " + value.length + " bytes ]";
			else if(key == "whiteboard" || key == "stream")
				return "[ Circular ]";
			else
				return value;
		}
		
		response.writeHead(200);
		response.end("whiteboards = " + JSON.stringify(whiteboards, replacer, 2) + "\n\nsessions = " + JSON.stringify(sessions, null, 2));
	}
	
	// new users are added directly to database by web server
	if(path == "/v1/auth") {
		var acceptauth = function() {
			var token       = rndstr();
			sessions[token] = new Session(args["user"], token);
			
			response.writeHead(200, {
				'Set-Cookie': 'session=' + token,
				'Content-Type': 'text/plain'
			});
			response.end();
		}
		
		if(!db) {
			// if no DB, accept all connections
			acceptauth();
			return;
		}
		
		// lookup user in DB
		db.get("SELECT password FROM users WHERE username = ?", args["user"], function(err, row) {
			if(row && wbDB.validateAppLogin(args["signature"], args["timestamp"], row.password)) {
				// TODO: actually verify that timestamp is within acceptable range
				// ... rather, the proper approach would be for the client to request a token and use that instead
				//  of timestamp to generate signature
				acceptauth();
				return;
			}
			//console.log("Auth failed for: " + request.url);
			// fall thru for all error cases
			response.writeHead(401);
			response.end("error: invalid username or password");
		});
		return;
	}
	
	// verify session cookie for all other paths
	var session = sessions[cookies["session"]];
	if(!session) {
		response.writeHead(403);
		response.end();
		return;
	}
	if(session.ctime + 5 * 60 * 1000 < Date.now()) {
		delete sessions[cookies["session"]];
		response.writeHead(408);
		response.end("error: session expired");
		return;
	}
	
	if(path == "/v1/createswb" || path == "/v1/openswb") {
		var repo = args["name"];
		if(!repo || (path == "/v1/openswb" && !whiteboards[repo]) || (path == "/v1/createswb" && whiteboards[repo])) {
			response.writeHead(404);
			response.end();
			return;
		}
		if(!whiteboards[repo]) {
			whiteboards[repo] = new Whiteboard(repo, Object.entries(args).map(e=>e[0]+"='"+e[1]+"'").join(" "), rndstr());
		}
		var wb    = whiteboards[repo];
		var token = md5(session.user + wb.token);
		
		response.writeHead(200);
		response.end("<swb " + wb.attribs + " user='" + session.user + "' token='" + token + "'/>");
	} else {
		response.writeHead(404);
		response.end();
	}
});

apiserver.listen(7000);


// shared whiteboarding server - basically just echos everything it receives to all clients
// we now rely on HTTP API server to create the whiteboard

// even with flush() of socket on client, no guarantee that commands will always be at the start of data chunks!

var swblog = logger('swblog');
swblog.setLogLevel(pargs["log-level"] || process.env.STYLUS_LOG_LEVEL || 'info');
//process.env.STYLUS_LOG_PATH && swblog.setLogFile(process.env.STYLUS_LOG_PATH + "/swbserver.log");
pargs["log-path"] && swblog.setLogFile(pargs["log-path"] + "/swbserver.log");

var swbserver = net.createServer(function(stream) {
	var client = new Client(stream);
	
	stream.setTimeout(0);
	stream.setEncoding("binary");
	swblog.info(client.remote + " connected");
	
	stream.on("data", function(data) {
		// don't print everything unless explicitly requested
		if(pargs["dump"])
			swblog.debug("SWB server rcvd from " + client.remote + " data:", data);
		
		while(data.length > 0) {
			if(client.expectdatalen > 0) {
				client.tempdata += data.substr(0, client.expectdatalen);
				if(client.expectdatalen > data.length) {
					client.expectdatalen -= data.length;
					return;
				}
				swblog.debug("SWB server rcvd " + client.tempdata.length + " bytes of data from " + client.remote);
				data                 = data.substr(client.expectdatalen);
				client.expectdatalen = 0;
				var wb               = client.whiteboard;
				wb.history          += client.tempdata;
				
				wb.clients.forEach(function(c) {
					// echo to all clients, including sender
					c.stream.write(client.tempdata, "binary");
				});
				
				client.tempdata = "";
				// fall through to handle rest of data ... after checking length again
				continue;
			}
			
			var delimidx = data.indexOf('\n');
			if(delimidx < 0) {
				client.cmdstr += data;
				return;
			}
			client.cmdstr += data.substr(0, delimidx);
			data           = data.substr(delimidx + 1);
			
			swblog.debug(client.remote + " sent command:", client.cmdstr);
			
			var parsed  = url.parse(client.cmdstr, true);  // parseQueryString = true
			var command = parsed.pathname;
			var args    = parsed.query;
			if(command == "/info") {
				// /info?document=<docname>
				// get list of current SWB users
				var repo = args["document"];
				if(whiteboards[repo]) {
					stream.write(whiteboards[repo].clients.map(c=>c.name).join(","));
				} else {
					stream.write("-");
				}
			} else if(command == "/start") {
				// arguments: version (protocal version) - ignored for now;, user, document, (history) offset (optional),
				//  token = MD5(user .. whiteboard.token)
				// history offset is 0 on initial connection; can be >0 when reconnecting
				var repo = args["document"];
				var wb   = whiteboards[repo];
				
				if(args["token"] == 'SCRIBBLE_SYNC_TEST' && pargs["enable-test"]) {
					swblog.info(client.remote + ": connecting to test whiteboard " + repo + " as " + args["user"]);
					if(!wb) {
						wb = new Whiteboard(repo);
						whiteboards[repo] = wb;
					}
				} else if(!wb || args["token"] != md5(args["user"] + wb.token)) {
					swblog.warn(client.remote + ": whiteboard not found or invalid token");
					stream.write("<undo><accessdenied message='Whiteboard not found. Please try again.'/></undo>\n");
					disconn(client);
					return;
				}
				
				client.whiteboard = wb;
				client.name       = args["user"];
				// send history
				if(wb.history.length > 0) {
					var histoffset = parseInt(args["offset"]);
					if(histoffset > 0)
						stream.write(wb.history.slice(histoffset), "binary");
					else
						stream.write(wb.history, "binary");
				}
				
				wb.clients.push(client);
				
				// if user was already connected as a different client, remove old client ... we've waited until new
				//  client has been added to wb.clients so disconn() won't delete the SWB if only one user.  Also
				//  have to wait until history is sent!
				wb.clients.forEach(function(c) {
					// use full disconnect procedure to send "disconnect" signal since we'll send "connect" signal below
					if(c.name == args["user"] && c != client) {
						swblog.info("disconnecting " + c.remote + " due to connection of " + client.remote + " for user: " + c.name);
						c.stream.write("<undo><accessdenied message='User logged in from another location.'/></undo>\n");
						disconn(c);
					}
				});
				
				// client can use uuid to distinguish this connect message from previous ones when reconnecting
				var msg     = "<undo><connect name='" + client.name + "' uuid='" + args["uuid"] + "'/></undo>\n";
				wb.history += msg;
				wb.clients.forEach(function(c) {
					c.stream.write(msg, "binary");
				});
			} else if(command == "/data") {
				client.expectdatalen = parseInt(args["length"]);
			} else if(command == "/end") {
				disconn(client);
				return;
			} else {
				swblog.warn(client.remote + " sent invalid command:", client.cmdstr);
				//disconn(client);
				//return;
			}
			
			client.cmdstr = "";
		}
	});
	
	function disconn(client) {
		swblog.info(client.remote + " disconnected");
		
		var wb = client.whiteboard;
		
		if(wb && wb.clients.remove(client)) {
			if(wb.clients.length == 0) {
				swblog.info("deleting whiteboard:", wb.repo);
				// delete whiteboard after last user disconnects
				delete whiteboards[wb.repo];
			} else {
				var msg     = "<undo><disconnect name='" + client.name + "'/></undo>\n";
				wb.history += msg;
				wb.clients.forEach(function(c) {
					c.stream.write(msg, "binary");
				});
			}
		}
		//client.stream.removeAllListeners();
		client.stream.end();
		client.cmdstr = "";
	}
	
	stream.on("end",   function()    { swblog.warn("disconnect due to stream end"        ); disconn(client); });
	stream.on("error", function(err) { swblog.warn("disconnect due to stream error:", err); disconn(client); });
});

swbserver.listen(7001);
