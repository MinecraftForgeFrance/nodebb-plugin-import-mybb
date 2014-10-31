
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

        Exporter.log(_config);

        Exporter.config(_config);
        Exporter.config('prefix', config.prefix || config.tablePrefix || 'mybb_');

        Exporter.connection = mysql.createConnection(_config);
        Exporter.connection.connect();

        callback(null, Exporter.config());
    };

    Exporter.getUsers = function(callback) {
        Exporter.log('getUsers');
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query = 'SELECT '
            + prefix + 'users.uid as _uid, '
            + prefix + 'users.username as _username, '
            + prefix + 'users.username as _alternativeUsername, '
            + prefix + 'users.email as _registrationEmail, '
            //+ prefix + 'users.user_rank as _level, '
            + prefix + 'users.regdate as _joindate, '
            + prefix + 'users.email as _email '
            //+ prefix + 'banlist.ban_id as _banned '
            + prefix + 'users.signature as _signature, '
            + prefix + 'users.website as _website, '
            //+ prefix + 'USER_PROFILE.USER_OCCUPATION as _occupation, '
            //+ prefix + 'USER_PROFILE.USER_LOCATION as _location, '
            + prefix + 'users.avatar as _picture, '
            + prefix + 'users.title as _title, '
            + prefix + 'users.reputation as _reputation, '
            //+ prefix + 'USER_PROFILE.USER_TOTAL_RATES as _profileviews, '
            + prefix + 'users.birthday as _birthday '

            + 'FROM ' + prefix + 'users '
            + 'WHERE ' + prefix + 'users.uid = ' + prefix + 'users.uid ';

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
                    if (row._username && row._email) {

                        // nbb forces signatures to be less than 150 chars
                        // keeping it HTML see https://github.com/akhoury/nodebb-plugin-import#markdown-note
                        row._signature = Exporter.truncateStr(row._signature || '', 150);

                        // from unix timestamp (s) to JS timestamp (ms)
                        row._joindate = ((row._joindate || 0) * 1000) || startms;

                        // lower case the email for consistency
                        row._email = row._email.toLowerCase();

                        // I don't know about you about I noticed a lot my users have incomplete urls, urls like: http://
                        row._picture = Exporter.validateUrl(row._picture);
                        row._website = Exporter.validateUrl(row._website);

                        map[row._uid] = row;
                    } else {
                        var requiredValues = [row._username, row._email];
                        var requiredKeys = ['_username','_email'];
                        var falsyIndex = Exporter.whichIsFalsy(requiredValues);

                        Exporter.warn('Skipping user._uid: ' + row._uid + ' because ' + requiredKeys[falsyIndex] + ' is falsy. Value: ' + requiredValues[falsyIndex]);

                    }
                });

                // keep a copy of the users in memory here
                Exporter._users = map;

                callback(null, map);
            });
    };

    Exporter.getCategories = function(callback) {
        Exporter.log('getCategories');
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query = 'SELECT '
            + prefix + 'forums.fid as _cid, '
            + prefix + 'forums.name as _name, '
            + prefix + 'forums.description as _description '
            + 'FROM ' + prefix + 'forums '

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
                    if (row._name) {
                        row._description = row._description || 'No decsciption available';
                        row._timestamp = ((row._timestamp || 0) * 1000) || startms;

                        map[row._cid] = row;
                    } else {
                        Exporter.warn('Skipping category._cid:' + row._cid + ' because category._name=' + row._name + ' is invalid');
                    }
                });

                // keep a copy in memory
                Exporter._categories = map;

                callback(null, map);
            });
    };

    Exporter.getTopics = function(callback) {
        Exporter.log('getTopics');
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
            + 'WHERE ' + prefix + 'threads.firstpost=' + prefix + 'posts.pid ';

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
                var msg = 'You must run getCategories() before you can getTopics()';

                if (!Exporter._categories) {
                    err = {error: 'Categories are not in memory. ' + msg};
                    Exporter.error(err.error);
                    return callback(err);
                }

                rows.forEach(function(row) {
                    if (Exporter._categories[row._cid]) {

                        row._title = row._title ? row._title[0].toUpperCase() + row._title.substr(1) : 'Untitled';
                        row._timestamp = ((row._timestamp || 0) * 1000) || startms;

                        map[row._tid] = row;
                    } else {
                        var requiredValues = [Exporter._categories[row._cid]];
                        var requiredKeys = ['category'];
                        var falsyIndex = Exporter.whichIsFalsy(requiredValues);

                        Exporter.warn('Skipping topic._tid: ' + row._tid + ' because ' + requiredKeys[falsyIndex] + ' is falsy. Value: ' + requiredValues[falsyIndex]);
                    }
                });

                // keep a copy in memory
                Exporter._topics = map;

                callback(null, map);
            });
    };

    Exporter.getPosts = function(callback) {
        Exporter.log('getPosts');
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

            
            + 'WHERE ' + prefix + 'posts.tid > 0 AND ' + prefix + 'posts.pid NOT IN (SELECT firstpost FROM ' + prefix + 'threads) ';

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
                var msg = 'You must run getTopics() before you can getPosts()';

                if (!Exporter._topics) {
                    err = {error: 'Topics are not in memory. ' + msg};
                    Exporter.error(err.error);
                    return callback(err);
                }

                rows.forEach(function(row) {
                    if (Exporter._topics[row._tid] && row._content) {
                        row._timestamp = ((row._timestamp || 0) * 1000) || startms;
                        map[row._pid] = row;
                    } else {
                        var requiredValues = [Exporter._topics[row._tid], row._content];
                        var requiredKeys = ['topic', 'content'];
                        var falsyIndex = Exporter.whichIsFalsy(requiredValues);

                        Exporter.warn('Skipping post._pid: ' + row._pid + ' because ' + requiredKeys[falsyIndex] + ' is falsy. Value: ' + requiredValues[falsyIndex]);
                    }
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
