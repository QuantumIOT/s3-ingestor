var _ = require('lodash');

function QiotHttpHost(){
    var self = this;

    // NOTE - delay loading for testability
    self.config         = require('./config');
    self.helpers        = require('./helpers');
    self.logger         = require('./logger');

    self.hostService    = require(self.config.settings.host_service);
    
    self.messageQueue   = [];
}

QiotHttpHost.prototype.registrationRequired = function(context){
    return !this.config.settings.qiot_account_token || !context.qiot_thing_token;
};

QiotHttpHost.prototype.contact = function(context){
    var self = this;

    if (!self.config.settings.qiot_account_token) return self.helpers.rejectionPromise('no account token');

    var path    = undefined;
    var message = {};

    self.collectContextMessages(context);

    if (context.qiot_thing_token) {
        message.messages    = self.messageQueue;
        path                = '/1/l/' + context.qiot_thing_token;
    } else {
        message.identity    = self.findIdentity();
        message.label       = message.identity[0].type + '-' + message.identity[0].value;
        path                = '/1/r';
    }

    var messageJSON = JSON.stringify(message);
    var options = {
        host:   self.config.settings.host_dns   || 'api.qiot.io',
        port:   self.config.settings.host_port  || self.helpers.bestPort(self.config.settings.host_service,8000),
        path:   path,
        method: 'POST',
        headers:{
            'Content-Type':     'application/json',
            'Authorization':    'QIOT ' + self.config.settings.qiot_account_token,
            'Content-Length':   Buffer.byteLength(messageJSON,'utf8')
        }
    };

    return new Promise(function(resolve,reject){
        self.logger.debug(function() { return 'host input: ' + messageJSON; });
        var request = self.hostService.request(options,function(response){

            if (context.qiot_thing_token) self.messageQueue = [];

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

                    if (!context.qiot_thing_token) {
                        if (!json.thing)
                            return reject('no registration received');
                        else {
                            self.logger.debug('registration received');

                            context.state                   = 'registered';
                            context.qiot_collection_token   = json.thing.collection_token;
                            context.qiot_thing_token        = json.thing.token;

                            if (self.config.settings.qiot_account_token != json.thing.account_token) context.config = {qiot_account_token: json.thing.account_token };
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

QiotHttpHost.prototype.findIdentity = function(){
    var self = this;

    if (self.helpers.processENV.QIOT_IDENTITY) return [{type: 'SN',value: self.helpers.processENV.QIOT_IDENTITY}];

    var macs = [];
    _.each(self.helpers.networkInterfaces(),function(value,key){
        _.each(value,function(option){
            if (!option.internal && option.mac && _.indexOf(macs,option.mac) < 0) macs.push(option.mac);
        })
    });

    return _.map(macs,function(mac){ return {type: 'MAC',value: mac}; })
};

QiotHttpHost.prototype.collectContextMessages = function(context){
    var self = this;

    var info = context.info || {};
    delete info.network;

    self.messageQueue.push({
        action:     context.action  || 'unspecified',
        version:    context.version || 'unspecified',
        info:       info,
        stats:      context.result  || {}
    });

    delete context.version;
    delete context.action;
    delete context.info;
    delete context.result;
};

module.exports = QiotHttpHost;
