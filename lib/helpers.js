var fs = require('fs');

var logger = require('./logger');

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

helpers.trimPrefix = function(string,prefix){
    return prefix.length > 0 && string.startsWith(prefix) ? string.slice(prefix.length) : string;
};

module.exports = helpers;