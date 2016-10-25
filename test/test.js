var _ = require('lodash');

var helpers = require(process.cwd() + '/lib/helpers');

module.exports.chai = require('chai');
module.exports.should = module.exports.chai.should();
module.exports.expect = module.exports.chai.expect;
module.exports.mockery = require('mockery');
module.exports.timekeeper = require('timekeeper');

// MOCK HELPERS

var MockHelpers = _.clone(helpers);

MockHelpers.resetMock = function(){
    MockHelpers.readError = false;
    MockHelpers.filesToRead = {};
    MockHelpers.filesRead = [];
    MockHelpers.filesSaved = [];
    MockHelpers.filesToRequire = {};
    MockHelpers.filesRequired = [];
};

MockHelpers.checkMockFiles = function(expectedReads,expectedSaves,expectedRequires){
    MockHelpers.filesRead.should.eql(expectedReads || []);
    MockHelpers.filesRead = [];

    MockHelpers.filesSaved.should.eql(expectedSaves || []);
    MockHelpers.filesSaved = [];
    
    MockHelpers.filesRequired.should.eql(expectedRequires || []);
    MockHelpers.filesRequired = [];
};

MockHelpers.readJSON = function(filename, defaultJSON, errorJSON){
    var status = undefined;
    if (MockHelpers.readError) {
        status = 'error';
    } else if (MockHelpers.filesToRead[filename]) {
        status = 'success';
    } else {
        status = 'default';
    }
    MockHelpers.filesRead.push([filename,status]);
    return MockHelpers.readError ? errorJSON : MockHelpers.filesToRead[filename] ? _.clone(MockHelpers.filesToRead[filename]) : defaultJSON;
};

MockHelpers.saveJSON = function(filename, json){
    MockHelpers.filesToRead[filename] = _.clone(json);
    MockHelpers.filesSaved.push([filename,json]);
};

MockHelpers.requireLIB = function(path) {
    MockHelpers.filesRequired.push(path);
    return MockHelpers.filesToRequire[path] || require(process.cwd() + '/lib/' + path);
};

MockHelpers.resetMock();

module.exports.mockHelpers = MockHelpers;

// MOCK LOGGER

var MockLogger = {debugging: false};

MockLogger.resetMock = function(){
    MockLogger.logEntries = [];
};

MockLogger.checkMockLogEntries = function(expectation){
    MockLogger.logEntries.should.eql(expectation || []);
    MockLogger.logEntries = [];
};

MockLogger.message = function(string){
    MockLogger.logEntries.push(string);
};

MockLogger.error = function(error) {
    MockLogger.logEntries.push('ERROR - ' + error);
};

MockLogger.debug = function(debug){
    MockLogger.debugging && MockLogger.message('DEBUG - ' + (typeof debug == 'function' ? debug() : debug));
};

MockLogger.resetMock();

module.exports.mockLogger = MockLogger;

// MOCK AWS-SDK

var MockS3 = {};

var MockAwsSdk = {};

MockAwsSdk.S3 = function(options){
    MockS3.options = options;
    return MockS3;
};

MockAwsSdk.Credentials = function(access_key_id, secret_access_key){
    return {access_key_id: access_key_id,secret_access_key: secret_access_key}
};

MockAwsSdk.resetMock = function(){
    MockS3 = {};
};

MockAwsSdk.checkMockState = function(){
  // TODO check mock state when there is some
};

module.exports.mockAwsSdk = MockAwsSdk;

// MOCK GLOB

function MockGlob(pattern, callback){
    var result = MockGlob.lookup[pattern];
    return result ? callback(null,result) : callback('GLOB error: ' + pattern,null);
}

MockGlob.resetMock = function(){
    MockGlob.lookup = {};
};

module.exports.mockGlob = MockGlob;

// MOCK HTTP

var MockHTTP = {
    resetMock: function(){
        MockHTTP.port = null;
        MockHTTP.app = null;
        MockHTTP.addressResult = null;
        MockHTTP.events = {};
        MockHTTP.headers = {};
        MockHTTP.statusCode = 200;
        MockHTTP.statusMessage = null;
        MockHTTP.requestError = null;
        MockHTTP.lastOptions = null;
        MockHTTP.written = [];
    },
    createServer: function(app){ MockHTTP.app = app; return MockHTTP; },
    listen: function(port){ MockHTTP.port = port; },
    address: function(){ return MockHTTP.addressResult || {addr: 'host',port: MockHTTP.port || 1234}; },
    on: function(event,callback){ MockHTTP.events[event] = callback; return MockHTTP; },
    request: function(options,callback){ MockHTTP.lastOptions = options; MockHTTP.callback = callback; return MockHTTP; },
    write: function(data) { MockHTTP.written.push(data); },
    send: function(data) { MockHTTP.written.push({send: data}); },
    end: function() {
        if (MockHTTP.requestError) {
            var error = new Error(MockHTTP.requestError);
            MockHTTP.written.push(error);
            MockHTTP.events.error && MockHTTP.events.error(error);
        } else {
            MockHTTP.written.push(null);
            MockHTTP.callback && MockHTTP.callback({statusCode: MockHTTP.statusCode,statusMessage: MockHTTP.statusMessage,headers: MockHTTP.headers,on: MockHTTP.on});
            MockHTTP.callback = null;
        }
    }
};

module.exports.mockHTTP = MockHTTP;

// MOCK HTTPS

var MockHTTPS = {
    resetMock: function(){
        MockHTTPS.port = null;
        MockHTTPS.app = null;
        MockHTTPS.addressResult = null;
        MockHTTPS.events = {};
        MockHTTPS.headers = {};
        MockHTTPS.statusCode = 200;
        MockHTTPS.statusMessage = null;
        MockHTTPS.requestError = null;
        MockHTTPS.lastOptions = null;
        MockHTTPS.written = [];
    },
    createServer: function(app){ MockHTTPS.app = app; return MockHTTPS; },
    listen: function(port){ MockHTTPS.port = port; },
    address: function(){ return MockHTTPS.addressResult || {addr: 'host',port: MockHTTPS.port || 1234}; },
    on: function(event,callback){ MockHTTPS.events[event] = callback; return MockHTTPS; },
    request: function(options,callback){ MockHTTPS.lastOptions = options; MockHTTPS.callback = callback; return MockHTTPS; },
    write: function(data) { MockHTTPS.written.push(data); },
    send: function(data) { MockHTTPS.written.push({send: data}); },
    end: function() {
        if (MockHTTPS.requestError) {
            var error = new Error(MockHTTPS.requestError);
            MockHTTPS.written.push(error);
            MockHTTPS.events.error && MockHTTPS.events.error(error);
        } else {
            MockHTTPS.written.push(null);
            MockHTTPS.callback && MockHTTPS.callback({statusCode: MockHTTPS.statusCode,statusMessage: MockHTTPS.statusMessage,headers: MockHTTPS.headers,on: MockHTTPS.on});
            MockHTTPS.callback = null;
        }
    }
};

module.exports.mockHTTPS = MockHTTPS;

// MOCK NET

var MockNET = {};

MockNET.resetMock = function() {
    MockNET.sockets = [];
};

MockNET.checkSockets = function(sockets){
    MockNET.sockets.should.eql(sockets || []);
    MockNET.sockets = [];
};

function MockSocket(){
    this.topics = {};
    this.calls = [];
    MockNET.sockets.push(this.calls);
}

MockSocket.prototype.recordCallback = function(topic,callback){
    this.calls.push(topic);
    this.topics[topic] = callback;
};

MockSocket.prototype.on = function(topic,callback) {
    this.recordCallback('on:' + topic,callback);
};

MockSocket.prototype.setTimeout = function(period,callback){
    this.recordCallback('setTimeout:' + period,callback);
    this.topics['timeout:' + period] = callback;
};

MockSocket.prototype.connect = function(port,host,callback){
    this.recordCallback('connect:' + host + ':' + port,callback);
};

MockNET.Socket = MockSocket;

module.exports.mockNET = MockNET;


// MOCK REDIS

var MockRedis = {events: {},calls: []};

MockRedis.resetMock = function(){
    MockRedis.clientException = null;
    MockRedis.events = {};
    MockRedis.errors = {};
    MockRedis.results = [];
    MockRedis.lookup = {
        brpop: [],
        keys: {},
        get: {},
        hgetall: {},
        hmset: {},
        llen: {},
        lpush: {}
    };
};

MockRedis.snapshot = function(){
    var result = MockRedis.calls;
    MockRedis.calls = [];
    return result;
};

MockRedis.createClient = function () {
    var internalClient = {
        end: function(){
            MockRedis.calls.push({end: null});
        }
    };
    var client = {
        _redisClient: internalClient,
        send: function(name,args) {
            return (client[name])(args);
        },
        then: function(callback) {
            if (!MockRedis.clientException){
                var result = MockRedis.results;
                MockRedis.results = null;
                callback && callback(result);
            }
            return client;
        },
        catch: function(callback){
            if (MockRedis.clientException){
                MockRedis.events.error && MockRedis.events.error(MockRedis.clientException);
                callback && callback(MockRedis.clientException);
            }
            return client;
        },
        errorHint: function(label) { return client.error(function(error){ MockLogger.error('error(' + label + '): ' + error); })},
        thenHint: function(label,callback) { return client.then(callback).errorHint(label); },
        done: function(){},
        on: function(event,callback) {
            MockRedis.events[event] = callback;
            MockRedis.results = null;
            return client;
        },
        brpop: function(args) {
            MockRedis.calls.push({brpop: args});
            MockRedis.results = MockRedis.lookup.brpop.pop() || null;
            return client;
        },
        del: function(args){
            MockRedis.calls.push({del: args});
            _.each(args,function(key){
                MockRedis.lookup.get[key] = null;
            });
            MockRedis.results = null;
            return client;
        },
        get: function(key) {
            MockRedis.calls.push({get: key});
            var result = MockRedis.lookup.get[key];
            MockRedis.results = result === null ? null : result || '0';
            return client;
        },
        hdel: function(args){
            MockRedis.calls.push({hdel: args});
            MockRedis.results = null;
            return client;
        },
        hgetall: function(key){
            MockRedis.calls.push({hgetall: key});
            MockRedis.results = MockRedis.lookup.hgetall[key] || null;
            return client;
        },
        hmset: function(key,values){
            var args = values ? [key,values] : key;
            MockRedis.calls.push({hmset: args});
            MockRedis.results = null;
            return client;
        },
        hset: function(key,subkey,value){
            MockRedis.calls.push({hset: [key,subkey,value]});
            MockRedis.results = null;
            return client;
        },
        hsetnx: function(key,subkey,value){
            MockRedis.calls.push({hsetnx: [key,subkey,value]});
            MockRedis.results = null;
            return client;
        },
        incr: function(key) {
            MockRedis.calls.push({incr: key});
            var value = +(MockRedis.lookup.get[key] || '0') + 1;
            MockRedis.lookup.get[key] = value.toString();
            MockRedis.results = MockRedis.lookup.get[key];
            return client;
        },
        keys: function(pattern) {
            MockRedis.calls.push({keys: pattern});
            MockRedis.results = MockRedis.lookup.keys[pattern] || [];
            return client;
        },
        llen: function(key) {
            MockRedis.calls.push({llen: key});
            MockRedis.results = MockRedis.lookup.llen[key] || '0';
            return client;
        },
        lpush: function(key,value) {
            MockRedis.calls.push({lpush: [key,value]});
            var list = MockRedis.lookup.lpush[key] = MockRedis.lookup.lpush[key] || [];
            list.unshift(value);
            MockRedis.results = null;
            return client;
        },
        mget: function(args){
            MockRedis.calls.push({mget: args});
            MockRedis.results = _.map(args,function(key){ return MockRedis.lookup.get[key] || null; });
            return client;
        },
        mset: function(){
            var args = _.toArray(arguments);
            if (args.length == 1 && _.isArray(args[0])) args = args[0];

            var key = null;
            _.each(args,function(element){
                if (!key)
                    key = element;
                else {
                    MockRedis.lookup.get[key] = element;
                    key = null;
                }
            });
            MockRedis.calls.push({mset: args});
            MockRedis.results = null;
            return client;
        },
        set: function(key,value){
            MockRedis.calls.push({set: [key,value]});
            MockRedis.lookup.get[key] = value;
            MockRedis.results = null;
            return client;
        },
        quit: function(){
            MockRedis.calls.push({quit: null});
            MockRedis.results = null;
            return client;
        }
    };
    return client;
};

module.exports.mockRedis = MockRedis;
