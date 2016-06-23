var fs = require('fs');

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

helpers.fileExists = function(filename){
    try {
        return fs.statSync(filename);
    } catch(error) {
        return null;
    }
};

helpers.requireLIB = function(module){
    return require(__dirname + '/' + module);
};

helpers.trimPrefix = function(string,prefix){
    return prefix.length > 0 && string.startsWith(prefix) ? string.slice(prefix.length) : string;
};

helpers.resetLogger = function(){
    logger = require('./logger');
};

helpers.resetLogger();

module.exports = helpers;