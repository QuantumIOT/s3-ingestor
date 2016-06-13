var _ = require('lodash');

var helpers = require(process.cwd() + '/lib/helpers');
var logger = require(process.cwd() + '/lib/logger');

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
    return MockHelpers.readError ? errorJSON : MockHelpers.filesToRead[filename] ? MockHelpers.filesToRead[filename] : defaultJSON;
};

MockHelpers.saveJSON = function(filename, json){
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
