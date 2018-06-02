
var async = require('async');
var mysql = require('mysql');
var _ = require('underscore');
var noop = function(){};
var logPrefix = '[nodebb-plugin-import-mybb]';

(function(Exporter) {

    Exporter.setup = function(config, callback) {
        Exporter.log('setup');

        // mysql db only config
        // extract them from the configs passed by the nodebb-plugin-import adapter
        var _config = {
            host: config.dbhost || config.host || 'localhost',
            user: config.dbuser || config.user || 'root',
            password: config.dbpass || config.pass || config.password || '',
            port: config.dbport || config.port || 3306,
            database: config.dbname || config.name || config.database || 'mybb'
        };

        Exporter.config(_config);
        Exporter.config('prefix', config.prefix || config.tablePrefix || '' /* phpbb_ ? */ );

        Exporter.connection = mysql.createConnection(_config);
        Exporter.connection.connect();

        callback(null, Exporter.config());
    };

    Exporter.getUsers = function(callback) {
        return Exporter.getPaginatedUsers(0, -1, callback);
    };
    Exporter.getPaginatedUsers = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query = 'SELECT '
            + prefix + 'users.uid as _uid, '
            + prefix + 'users.password as _password'
            + prefix + 'users.username as _username, '
            + prefix + 'users.username as _alternativeUsername, '
            + prefix + 'users.email as _registrationEmail, '
            //+ prefix + 'users.user_rank as _level, '
            + prefix + 'users.regdate as _joindate, '
            + prefix + 'users.lastpost as _lastposttime, '
            + prefix + 'users.lastvisit as _lastonline, ' 
            + prefix + 'users.email as _email '
            //+ prefix + 'banlist.ban_id as _banned '
            + prefix + 'users.signature as _signature, '
            + prefix + 'users.website as _website, '
            + prefix + 'users.avatar as _picture, '
            + prefix + 'users.reputation as _reputation, '
            + prefix + 'users.birthday as _birthday '
            + prefix + 'users.hideemail '
            + prefix + 'userfields.fid1 as _location '
            + prefix + 'userfields.fid2 as _aboutme ' // not supported, need fork


            + 'FROM ' + prefix + 'users '
            + 'LEFT JOIN  ' + prefix + 'userfields ON ' + prefix + 'userfields.ufid='+ prefix + 'users.uid '
            + 'WHERE ' + prefix + 'users.uid = ' + prefix + 'users.uid '
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');


        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize here
                var map = {};
                rows.forEach(function(row) {
                    // nbb forces signatures to be less than 150 chars
                    // keeping it HTML see https://github.com/akhoury/nodebb-plugin-import#markdown-note
                    row._signature = Exporter.truncateStr(row._signature || '', 150);

                    // from unix timestamp (s) to JS timestamp (ms)
                    row._joindate = ((row._joindate || 0) * 1000) || startms;
                    row._lastposttime = ((row._lastposttime || 0) * 1000) || '';

                    // lower case the email for consistency
                    row._email = (row._email || '').toLowerCase();
                    // mybb prop is hide email, so fix it by toggle
                    row._showemail = (row.hideemail == 0);

                    // I don't know about you about I noticed a lot my users have incomplete urls, urls like: http://
                    row._picture = Exporter.validateUrl(row._picture);
                    row._website = Exporter.validateUrl(row._website);
                    if(row._password.charAt(0) != '$') { // this user didn't change his password after we install dzhash, so the password can't be imported
                        delete row._password;
                    }

                    map[row._uid] = row;
                });

                callback(null, map);
            });
    };

    Exporter.getCategories = function(callback) {
        return Exporter.getPaginatedCategories(0, -1, callback);    
    };
    Exporter.getPaginatedCategories = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query = 'SELECT '
            + prefix + 'forums.fid as _cid, '
            + prefix + 'forums.name as _name, '
            + prefix + 'forums.description as _description '
            + 'FROM ' + prefix + 'forums '
            +  (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');
            
        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize here
                var map = {};
                rows.forEach(function(row) {
                    row._name = row._name || 'Untitled Category';
                    row._description = row._description || 'No decsciption available';
                    row._timestamp = ((row._timestamp || 0) * 1000) || startms;

                    map[row._cid] = row;
                });

                callback(null, map);
            });
    };

    Exporter.getTopics = function(callback) {
        return Exporter.getPaginatedTopics(0, -1, callback);
    };
    Exporter.getPaginatedTopics = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query =
            'SELECT '
            + prefix + 'threads.tid as _tid, '
            + prefix + 'threads.fid as _cid, '

            // this is the 'parent-post'
            // see https://github.com/akhoury/nodebb-plugin-import#important-note-on-topics-and-posts
            // I don't really need it since I just do a simple join and get its content, but I will include for the reference
            // remember this post EXCLUDED in the exportPosts() function
            + prefix + 'threads.firstpost as _pid, '

            + prefix + 'threads.views as _viewcount, '
            + prefix + 'threads.subject as _title, '
            + prefix + 'threads.dateline as _timestamp, '
            + prefix + 'threads.status as mysupportstatus '  // not supported, need fork
            + prefix + 'threads.statusuid as mysupportstatususer '  // not supported, need fork
            + prefix + 'threads.bestanswer as _solvedPid '  // not supported, need fork

            // maybe use that to skip
            //+ prefix + 'threads.topic_approved as _approved, '

            //+ prefix + 'threads.topic_status as _status, '

            + prefix + 'posts.sticky as _pinned, '
            + prefix + 'posts.uid as _uid, '
            // this should be == to the _tid on top of this query
            + prefix + 'posts.tid as _post_tid, '

            // and there is the content I need !!
            + prefix + 'posts.message as _content '
            

            + 'FROM ' + prefix + 'threads, ' + prefix + 'posts '
            // see
            + 'WHERE ' + prefix + 'threads.firstpost=' + prefix + 'posts.pid '
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');


        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize here
                var map = {};
                rows.forEach(function(row) {
                    row._title = row._title ? row._title[0].toUpperCase() + row._title.substr(1) : 'Untitled';
                    row._timestamp = ((row._timestamp || 0) * 1000) || startms;
                    if(row.mysupportstatususer) {
                        row._isQuestion = 1;
                        row._isSolved = row.mysupportstatus;
                    }
                    delete row.mysupportstatususer;
                    delete row.mysupportstatus;

                    map[row._tid] = row;
                });

                callback(null, map);
            });
    };

	var getTopicsMainPids = function(callback) {
		if (Exporter._topicsMainPids) {
			return callback(null, Exporter._topicsMainPids);
		}
		Exporter.getPaginatedTopics(0, -1, function(err, topicsMap) {
			if (err) return callback(err);

			Exporter._topicsMainPids = {};
			Object.keys(topicsMap).forEach(function(_tid) {
				var topic = topicsMap[_tid];
				Exporter._topicsMainPids[topic.topic_first_post_id] = topic._tid;
			});
			callback(null, Exporter._topicsMainPids);
		});
    };
    
    Exporter.getPosts = function(callback) {
        return Exporter.getPaginatedPosts(0, -1, callback);
    };
    Exporter.getPaginatedPosts = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query =
            'SELECT ' + prefix + 'posts.pid as _pid, '
            + prefix + 'posts.replyto as _post_replying_to, '
            + prefix + 'posts.tid as _tid, '
            + prefix + 'posts.dateline as _timestamp, '
            // not being used
            + prefix + 'posts.subject as _subject, '

            + prefix + 'posts.message as _content, '
            + prefix + 'posts.uid as _uid, '

            // I couldnt tell what's the different, they're all HTML to me
            //+ prefix + 'POST_MARKUP_TYPE as _markup, '
            // maybe use this one to skip
            + prefix + 'posts.visible as _approved ' //ASCIIcat - Not to sure about MyBB here I think this would do it for _approved assuming that if its not visible its not approved

            + 'FROM ' + prefix + 'posts '
            // this post cannot be a its topic's main post, it MUST be a reply-post
            // see https://github.com/akhoury/nodebb-plugin-import#important-note-on-topics-and-posts

            
            + 'WHERE ' + prefix + 'posts.tid > 0 AND ' + prefix + 'posts.pid NOT IN (SELECT firstpost FROM ' + prefix + 'threads) '
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

		Exporter.connection.query(query,
			function (err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}
				getTopicsMainPids(function(err, mpids) {
					//normalize here
					var map = {};
					rows.forEach(function (row) {
						// make it's not a topic
						if (! mpids[row._pid]) {
							row._content = row._content || '';
							row._timestamp = ((row._timestamp || 0) * 1000) || startms;
							map[row._pid] = row;
						}
					});

					callback(null, map);
				});
			});
    };

    Exporter.getMessages = function(callback) {
        return Exporter.getPaginatedMessages(0, -1, callback);
    };
    Exporter.getPaginatedMessages = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var query =
            'SELECT DISTINCT ' + prefix + 'privatemessages.pmid as _mid, '
            + prefix + 'privatemessages.fromid as _fromuid, '
            + prefix + 'privatemessages.toid as _touid, '
            + prefix + 'privatemessages.dateline as _timestamp, '
            // not being used
            + prefix + 'privatemessages.subject as _subject, '
            + prefix + 'privatemessages.message as _content, '

            + 'FROM ' + prefix + 'privatemessages '
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query, function(err, rows) {
            if (err) {
                Exporter.error(err);
                return callback(err);
            }

            //normalize here
            var map = {};
            rows.forEach(function(row) {
                // remove quote in content, to avoid duplicate.
                row._content = row._content.replace(/\[quote=["]?([\s\S]*?)["]?\]([\s\S]*?)\[\/quote\]/gi, '');

                map[row._mid] = row;
            });

            callback(null, map);
        });
    };

    Exporter.getVotes = function(callback) {
        return Exporter.getPaginatedVotes(0, -1, callback);
    };
    Exporter.getPaginatedVotes = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var query =
            'SELECT ' + prefix + 'reputation.rid as _vid, '
            + prefix + 'reputation.adduid as _uid, '
            + prefix + 'reputation.pid as _pid, '
            + prefix + 'reputation.reputation as _action, '

            + 'FROM ' + prefix + 'reputation '
            + 'WHERE ' + prefix + 'reputation.reputation != 0 AND ' + prefix + 'reputation.pid != 0 ' 
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query, function(err, rows) {
            if (err) {
                Exporter.error(err);
                return callback(err);
            }

            //normalize here
            var map = {};
            rows.forEach(function(row) {
                row._action = (row._action > 0 ? 1 : -1);

                map[row._vid] = row;
            });

            callback(null, map);
        });
    };

    Exporter.teardown = function(callback) {
        Exporter.log('teardown');
        Exporter.connection.end();

        Exporter.log('Done');
        callback();
    };

    Exporter.testrun = function(config, callback) {
        async.series([
            function(next) {
                Exporter.setup(config, next);
            },
            function(next) {
                Exporter.getUsers(next);
            },
            function(next) {
                Exporter.getCategories(next);
            },
            function(next) {
                Exporter.getTopics(next);
            },
            function(next) {
                Exporter.getPosts(next);
            },
            function(next) {
                Exporter.teardown(next);
            }
        ], callback);
    };
    
    Exporter.paginatedTestrun = function(config, callback) {
        async.series([
            function(next) {
                Exporter.setup(config, next);
            },
            function(next) {
                Exporter.getPaginatedUsers(0, 1000, next);
            },
            function(next) {
                Exporter.getPaginatedCategories(0, 1000, next);
            },
            function(next) {
                Exporter.getPaginatedTopics(0, 1000, next);
            },
            function(next) {
                Exporter.getPaginatedPosts(1001, 2000, next);
            },
            function(next) {
                Exporter.teardown(next);
            }
        ], callback);
    };

    Exporter.warn = function() {
        var args = _.toArray(arguments);
        args.unshift(logPrefix);
        console.warn.apply(console, args);
    };

    Exporter.log = function() {
        var args = _.toArray(arguments);
        args.unshift(logPrefix);
        console.log.apply(console, args);
    };

    Exporter.error = function() {
        var args = _.toArray(arguments);
        args.unshift(logPrefix);
        console.error.apply(console, args);
    };

    Exporter.config = function(config, val) {
        if (config != null) {
            if (typeof config === 'object') {
                Exporter._config = config;
            } else if (typeof config === 'string') {
                if (val != null) {
                    Exporter._config = Exporter._config || {};
                    Exporter._config[config] = val;
                }
                return Exporter._config[config];
            }
        }
        return Exporter._config;
    };

    // from Angular https://github.com/angular/angular.js/blob/master/src/ng/directive/input.js#L11
    Exporter.validateUrl = function(url) {
        var pattern = /^(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?$/;
        return url && url.length < 2083 && url.match(pattern) ? url : '';
    };

    Exporter.truncateStr = function(str, len) {
        if (typeof str != 'string') return str;
        len = _.isNumber(len) && len > 3 ? len : 20;
        return str.length <= len ? str : str.substr(0, len - 3) + '...';
    };

    Exporter.whichIsFalsy = function(arr) {
        for (var i = 0; i < arr.length; i++) {
            if (!arr[i])
                return i;
        }
        return null;
    };

})(module.exports);