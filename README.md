# Stylusboard #

Shared whiteboard server for [Stylus Labs Write](http://www.styluslabs.com) - enables multiple users to collaborate in real time on a handwritten document.
To set your server as the default in Write, enable advanced preferences, then in the Advanced -> Whiteboard server field enter the host name or IP address of the machine running this server.

To connect to a different server and/or with a different username than the default, use the following format for the whiteboard ID in the Open Whiteboard and Create Whiteboard dialogs:
```
[user[:password]@server/]whiteboard_id
```

Run `node.js whiteboard.js`.  Tested with node.js 12.18.3 (and 0.10.36)

Linux executable packaged with jx: http://www.styluslabs.com/write/stylusboard (Download and run this to get started quickly).

By default, runs in anonymous mode, accepting all connections.  To require login, specify a sqlite database file with the --db argument or db option in config file.  dbUtil.js can be used to create and add users to the database - run `node dbUtil.js help` for options.

Contact support at styluslabs.com with any issues or to request changes to the client-side code in Write.
