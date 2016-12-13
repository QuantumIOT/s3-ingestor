var _ = require('lodash');
var http = require('http');
var events = require('events');

var helpers = require('./lib/helpers');
var logger  = require('./lib/logger');
var config  = require('./lib/config');

var PhoneHome = require('./lib/phone-home');

var VERSION = helpers.readJSON(__dirname + '/package.json',{version: 'UNKNOWN'},{version: 'ERROR'}).version;
var emitter = new events.EventEmitter();
var phoneHome = new PhoneHome(emitter,VERSION);

emitter.on('startup',function(){
    logger.message('-----------------------------------------------------------');
    emitter.emit('phonehome',phoneHome.host.registrationRequired(phoneHome.readContext()) ? 'register' : 'startup');

    var apiServer = http.createServer(function(req,res) {
        var context = phoneHome.readContext();
        var info = phoneHome.readLocalInfo();
        info.state = context.state || 'unknown';
        info.version = VERSION;

        logger.message('wakeup ' + JSON.stringify(info));

        res.writeHead(200, {'Content-Type': 'text/json'});
        res.end(JSON.stringify(info));

        phoneHome.resetPolicies();
        emitter.emit('phonehome','wakeup');
    });

    apiServer.listen(config.settings.api_port,'0.0.0.0');

    logger.message('Server running at http://0.0.0.0:' + config.settings.api_port);
});

emitter.on('phonehome',_.bind(phoneHome.handlePhoneHomeEvent,phoneHome));

_.defer(function(){ emitter.emit('startup'); }); // start after the 'requirer' has finished what he is doing...

module.exports = {
    VERSION: VERSION,
    config: config,
    emitter: emitter,
    phoneHome: phoneHome
};