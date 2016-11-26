var _   = require('lodash');

function QiotHost(){
    var self = this;

    // NOTE - delay loading for testability
    self.config     = require('./config');
    self.helpers    = require('./helpers');
    self.logger     = require('./logger');

    self.hostService = require(self.config.settings.host_service);
}

QiotHost.prototype.registrationRequired = function(){
    return !this.config.settings.qiot_account_token;
};

QiotHost.prototype.contact = function(context){
    var self = this;

    var version = context.version;
    var action  = context.action;
    var info    = context.info;

    delete context.version;
    delete context.action;
    delete context.info;

    var path    = undefined;
    var message = {};
    var headers = { 'Content-Type' : 'application/json' };

    if (self.config.settings.qiot_account_token) {
        headers['Authorization'] = 'QIOT ' + self.config.settings.qiot_account_token;

        message.messages = [];
        self.addMessagesFromContext(message.messages,context);

        path = '/1/l/' + self.config.settings.qiot_thing_token;
    } else {
        message.identity = self.findIdentity();
        message.label    = message.identity[0].type + '-' + message.identity[0].value;

        path = '/1/r';
    }

    var messageJSON = JSON.stringify(message);
    headers['Content-Length'] = Buffer.byteLength(messageJSON,'utf8');

    var options = {
        host:       self.config.settings.host_dns,
        port:       self.config.settings.host_port,
        path:       path,
        method:     'POST',
        headers:    headers
    };

    return new Promise(function(resolve,reject){
        self.logger.debug(function() { return 'host input: ' + messageJSON; });
        var request = self.hostService.request(options,function(response){

            if (response.statusCode == 204) {
                self.logger.debug('host response 204');
                return resolve(context);
            }

            response.on('data',function(data){
                try {
                    var dataString = data.toString();
                    self.logger.debug(function() { return 'host output: ' + dataString });

                    var json = self.helpers.safeParseJSON(dataString);
                    if (!json) return reject('no json received');

                    if (self.registrationRequired()) {
                        if (!json.thing)
                            return reject('no registration received');
                        else {
                            self.logger.debug('registration received');
                            context.state  = 'registered';
                            context.config = {
                                qiot_account_token:     json.thing.account_token,
                                qiot_collection_token:  json.thing.collection_token,
                                qiot_thing_token:       json.thing.token
                            };
                        }
                    }

                    resolve(context);
                } catch(error) {
                    reject(error);
                }
            });
        });
        request.on('error',reject);
        request.write(messageJSON);
        request.end();
    });
};

QiotHost.prototype.findIdentity = function(){
    var self = this;

    var macs = [];
    _.each(self.helpers.networkInterfaces(),function(value,key){
        _.each(value,function(option){
            if (!option.internal && option.mac && _.indexOf(macs,option.mac) < 0) macs.push(option.mac);
        })
    });

    return _.map(macs,function(mac){ return {type: 'MAC',value: mac}; })
};

QiotHost.prototype.addMessagesFromContext = function(messages,context){

};

module.exports = QiotHost;
