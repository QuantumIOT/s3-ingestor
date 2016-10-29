var fs = require('fs');
var process = require('process');
var child_process = require('child_process');

var logger = undefined;

var helpers = {};

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
helpers.writeFile   = fs.writeFile;
helpers.processExit = process.exit;
helpers.processExec = child_process.exec;


helpers.requireLIB = function(module){
``    var libPath = __dirname + '/' + module;
    return helpers.fileExists(libPath + '.js') && require(libPath);
};

helpers.trimPrefix = function(string,prefix){
    return prefix.length > 0 && string.startsWith(prefix) ? string.slice(prefix.length) : string;
};

helpers.resetLogger = function(){
    logger = require('./logger');
};

helpers.resetLogger();

module.exports = helpers;