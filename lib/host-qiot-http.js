var _ = require('lodash');
var codes = require('http-status-codes');

function QiotHttpHost(emitter){
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

    return self.hostRequest('POST','/1/r',message,function(status,data,resolve,reject){

        if (status != codes.OK) return reject('registration rejected: ' + codes.getStatusText(status));

        if (!data.thing) return reject('no registration received');

        self.logger.debug('registration received');

        context.state                   = 'registered';
        context.qiot_collection_token   = data.thing.collection_token;
        context.qiot_thing_token        = data.thing.thing_token || data.thing.token; // TODO remove data.thing.token when no longer in use...

        if (self.config.settings.qiot_account_token != data.thing.account_token) context.config = {qiot_account_token: data.thing.account_token };

        resolve(context);

    });
};

QiotHttpHost.prototype.sendMessages = function(context){
    var self = this;

    return self.hostRequest('POST','/1/l/' + context.qiot_thing_token,{messages: self.messageQueue},function(status,data,resolve,reject){
        if (status != codes.OK && status != codes.NO_CONTENT) return reject('delivery failure: ' + codes.getStatusText(status));

        self.messageQueue = [];

        self.checkMailbox(context,resolve,reject);
    });
};

QiotHttpHost.prototype.checkMailbox = function(context,resolve,reject) {
    var self = this;

    function receiveMailMessages(status,data,interiorResolve,interiorReject){
        switch(status){
        case codes.OK:
            context = self.updateContext(context,data); // NOTE - drop through to interior resolve

        case codes.NO_CONTENT:
        case codes.NOT_FOUND:
            interiorResolve(context);
            break;
        default:
            interiorReject('mailbox failure: ' + codes.getStatusText(status));
        }
    }

    self.hostRequest('GET','/1/m/' + context.qiot_thing_token,null,receiveMailMessages).then(resolve,reject);
};

QiotHttpHost.prototype.updateContext = function(context,data) {
    var self = this;

    var time = data.time;
    if (time && (!context.thing_mailbox_time || time > context.thing_mailbox_time)) {
        delete data.content;

        self.logger.debug(function(){ return 'mailbox delivery' + JSON.stringify(data); });

        delete data.time;
        context.thing_mailbox_time = time;
        context = _.merge(context,data);
    }
    return context;
};

QiotHttpHost.prototype.hostRequest = function(method,path,message,callback){
    var self = this;

    var messageJSON = message ? JSON.stringify(message) : null;

    var options = {
        method: method,
        host:   self.config.settings.host_dns   || 'api.qiot.io',
        port:   self.config.settings.host_port  || self.helpers.bestPort(self.config.settings.host_service,8000),
        path:   path,
        headers:{
            'Content-Type':     'application/json',
            'Authorization':    'QIOT ' + self.config.settings.qiot_account_token
        }
    };

    if (messageJSON) options.headers['Content-Length'] = Buffer.byteLength(messageJSON,'utf8');

    self.logger.debug(function() { return 'host '+ method + ' ' + path +': ' + messageJSON; });

    return new Promise(function(resolve,reject){
        var request = self.hostService.request(options,function(response){
            var error   = null;
            var data    = null;

            response.on('data',function(dataBuffer){
                try {
                    var dataJSON = dataBuffer.toString();

                    self.logger.debug(function() { return 'host output: ' + dataJSON });

                    data = self.helpers.safeParseJSON(dataJSON);

                    if (!data) error = 'no json received';

                } catch(err) {
                    error = err;
                }
            });

            response.on('end',function(){
                self.logger.debug(function() { return 'host status: ' + codes.getStatusText(response.statusCode); });

                if (error)
                    reject(error);
                else
                    callback(response.statusCode,data,resolve,reject);
            });
        });

        request.on('error',reject);

        if (messageJSON) request.write(messageJSON);

        request.end();
    });
};

QiotHttpHost.prototype.findIdentity = function(){
    var self = this;

    if (self.helpers.processENV.QIOT_IDENTITY) return [{type: 'SN',value: self.helpers.processENV.QIOT_IDENTITY}];

    var macs = [];
    _.each(self.helpers.networkInterfaces(),function(value,key){
        _.each(value,function(option){
            if (!option.internal && option.mac && option.mac != '00:00:00:00:00:00' && _.indexOf(macs,option.mac) < 0) macs.push(option.mac);
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
