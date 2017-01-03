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

    self.collectContextMessages(context);

    return context.qiot_thing_token ? self.sendMessages(context) : self.register(context);
};

QiotHttpHost.prototype.register = function(context){
    var self = this;

    var message = {};
    message.identity    = self.findIdentity();
    message.label       = message.identity[0].type + '-' + message.identity[0].value;

    return self.hostRequest('/1/r',message,function(data,resolve,reject){

        if (!data.thing) return reject('no registration received');

        self.logger.debug('registration received');

        context.state                   = 'registered';
        context.qiot_collection_token   = data.thing.collection_token;
        context.qiot_thing_token        = data.thing.token;

        if (self.config.settings.qiot_account_token != data.thing.account_token) context.config = {qiot_account_token: data.thing.account_token };

        resolve(context);

    });
};

QiotHttpHost.prototype.sendMessages = function(context){
    var self = this;

    return self.hostRequest('/1/l/' + context.qiot_thing_token,{messages: self.messageQueue},function(data,resolve,reject){

        self.messageQueue = [];

        self.checkMailbox(context,resolve,reject);

    });
};

QiotHttpHost.prototype.checkMailbox = function(context,resolve,reject) {
    resolve(context);
};

QiotHttpHost.prototype.hostRequest = function(path,message,callback){
    var self = this;

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

    self.logger.debug(function() { return 'host input: ' + messageJSON; });

    return new Promise(function(resolve,reject){
        var request = self.hostService.request(options,function(response){
            if (response.statusCode == 204) {
                self.logger.debug('host response 204');

                return callback(null,resolve,reject);
            }

            response.on('data',function(dataBuffer){
                try {
                    var dataJSON = dataBuffer.toString();

                    self.logger.debug(function() { return 'host output: ' + dataJSON });

                    var data = self.helpers.safeParseJSON(dataJSON);

                    if (!data) return reject('no json received');

                    callback(data,resolve,reject);

                } catch(error) {
                    reject(error);
                }
            });

            // TODO what if no data received???
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
