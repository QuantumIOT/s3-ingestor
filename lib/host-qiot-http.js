var _ = require('lodash');
var codes = require('http-status-codes');
var os = require('os');

function QiotHttpHost(emitter){
    var self = this;

    // NOTE - delay loading for testability
    self.config         = require('./config');
    self.helpers        = require('./helpers');
    self.logger         = require('./logger');

    self.hostService    = require(self.config.settings.qiot_service);
    
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
        context.qiot_thing_token        = data.thing.thing_token;

        // TODO - what if (self.config.settings.qiot_account_token !== data.thing.account_token) ???

        resolve(context);
    });
};

QiotHttpHost.prototype.sendMessages = function(context){
    var self = this;

    return self.hostRequest('POST','/1/l/' + context.qiot_thing_token,{messages: self.messageQueue},function(status,data,resolve,reject){
        if (status !== codes.OK && status !== codes.NO_CONTENT) return reject('delivery failure: ' + codes.getStatusText(status));

        self.messageQueue = [];

        self.checkMailbox(context,resolve,reject);
    });
};

QiotHttpHost.prototype.checkMailbox = function(context,resolve,reject) {
    var self = this;

    function receiveMailMessage(status,message,interiorResolve,interiorReject){
        switch(status){
        case codes.OK:
            self.ackMailboxMessage(context,message,interiorResolve,interiorReject);
            break;

        case codes.NO_CONTENT:
        case codes.NOT_FOUND:
            interiorResolve(context);
            break;
        default:
            interiorReject('mailbox failure: ' + codes.getStatusText(status));
        }
    }

    self.hostRequest('GET','/1/m/' + context.qiot_thing_token,null,receiveMailMessage).then(resolve,reject);
};

QiotHttpHost.prototype.ackMailboxMessage = function(context,message,resolve,reject) {
    var self = this;

    var ack = {status: 'success',command_id: message.id};

    if (message.id === context.last_mailbox_id)
        self.logger.debug(function(){ return 'skip mailbox message: ' + JSON.stringify(message); });
    else {
        var payload = self.helpers.safeParseJSON(message.payload);

        if (!_.isPlainObject(payload)) {
            self.logger.error('invalid mailbox payload: ' + message.payload);
            ack.status = 'failure';
        } else {
            self.logger.debug(function(){ return 'mailbox delivery: ' + JSON.stringify(message); });

            context.last_mailbox_id = message.id;

            context = _.merge(context,payload);
        }
    }

    function receiveAckResponse(status,data,interiorResolve,interiorReject){
        switch(status){
            case codes.OK:
                interiorResolve(context);
                break;

            default:
                interiorReject('ack failure: ' + codes.getStatusText(status));
        }
    }

    self.hostRequest('POST','/1/a/' + context.qiot_thing_token,ack,receiveAckResponse).then(resolve,reject);

    return context;
};

QiotHttpHost.prototype.hostRequest = function(method,path,message,callback){
    var self = this;

    var messageJSON = message ? JSON.stringify(message) : null;

    var options = {
        method: method,
        host:   self.config.settings.qiot_dns   || 'api.qiot.io',
        port:   self.config.settings.qiot_port  || self.helpers.bestPort(self.config.settings.qiot_service,8000),
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

    return self.helpers.processENV.QIOT_IDENTITY ?
        [{type: 'ENV',      value: self.helpers.processENV.QIOT_IDENTITY}] :
        [{type: 'HOSTNAME', value: self.config.settings.hostname_override || os.hostname()}];
};

QiotHttpHost.prototype.collectContextMessages = function(context){
    var self = this;

    var message = {
        state:      context.state   || 'unspecified',
        action:     context.action  || 'unspecified',
        version:    context.version || 'unspecified',

        action_id:  self.findActionID(context.action),
        state_id:   self.findStateID(context.state)
    };

    if (context.result) message.result = context.result;

    if (context.info) {
        message.info = context.info;
        delete context.info.network;
    }

    self.messageQueue.push(message);

    delete context.version;
    delete context.action;
    delete context.info;
    delete context.result;
};

QiotHttpHost.prototype.findActionID = function(action){
    if (!action) return -1;

    var parts = action.split('+');
    return ['register','startup','wakeup','heartbeat','ack','report','customizers','upgrade','restart','reboot'].indexOf(parts[0]);
};

QiotHttpHost.prototype.findStateID = function(state){
    return ['registered','configured'].indexOf(state);
};

module.exports = QiotHttpHost;
