var fs = require('fs');
var os  = require('os');
var process = require('process');
var child_process = require('child_process');

var logger = undefined;

var helpers = {};

helpers.bestPort = function(service,defaultPort){ return service == 'http' ? 80 : service == 'https' ? 443 : defaultPort; };

helpers.bestHost = function(emitter,settings) {
    helpers.lastHostName = settings.host_handler ? settings.host_handler : settings.qiot_account_token ? 'host-qiot-mqtt' : 'host-basic';
    var HostHandler = helpers.requireLIB(helpers.lastHostName);
    return new HostHandler(emitter);
};

helpers.passThroughPromise = function(result){
    return new Promise(function(resolve,reject){ resolve(result); });
};

helpers.rejectionPromise = function(message) {
    return new Promise(function(resolve,reject){ reject(message); });
};

helpers.readJSON = function(filename,defaultJSON,errorJSON){
    try {
        return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename)) : defaultJSON;
    } catch(error) {
        logger.error(error);
        return errorJSON;
    }
};

helpers.saveJSON = function(filename,json){
    try {
        fs.writeFileSync(filename,JSON.stringify(json));
    } catch(error) {
        logger.error('save JSON error - ' + error);
    }
};

helpers.safeParseJSON = function(json) {
    try {
        return JSON.parse(json);
    } catch(e) {
        logger.error('json error: ' + e);
        return null;
    }
};

helpers.fileExists = function(filename){
    try {
        return fs.statSync(filename);
    } catch(error) {
        return null;
    }
};

helpers.mkdir       = fs.mkdir;
helpers.mkdirSync   = fs.mkdirSync;
helpers.readdirSync = fs.readdirSync;
helpers.writeFile   = fs.writeFile;
helpers.renameSync  = fs.renameSync;
helpers.unlinkSync  = fs.unlinkSync;

helpers.processENV  = process.env;
helpers.processCWD  = process.cwd;
helpers.processExit = process.exit;
helpers.processExec = child_process.exec;

helpers.networkInterfaces = os.networkInterfaces;

helpers.requireLIB = function(module){
    var libPath = __dirname + '/' + module;
    return helpers.fileExists(libPath + '.js') && require(libPath);
};

helpers.trimPrefix = function(string,prefix){
    return prefix.length > 0 && string.startsWith(prefix) ? string.slice(prefix.length) : string;
};

helpers.isoTimestamp = function(){
    return new Date().toISOString();
};

helpers.resetLogger = function(){
    logger = require('./logger');
};

helpers.resetLogger();

module.exports = helpers;