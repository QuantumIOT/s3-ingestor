var _ = require('lodash');

function QiotMqttHost(emitter){
    var self = this;

    self.emitter        = emitter;
    self.mailboxMessage = null;

    // NOTE - delay loading for testability
    self.mqtt           = require('mqtt');

    self.config         = require('./config');
    self.helpers        = require('./helpers');
    self.logger         = require('./logger');

    var QiotHttpHost    = require('./host-qiot-http');

    self.httpHost       = new QiotHttpHost(emitter);
}

QiotMqttHost.prototype.registrationRequired = function(context){
    return this.httpHost.registrationRequired(context);
};

QiotMqttHost.prototype.contact = function(context){
    var self = this;

    if (self.registrationRequired(context)) return self.httpHost.contact(context);

    self.httpHost.collectContextMessages(context);

    var mqttOptions = {qos: 0,retain: true};
    var message     = {messages: self.httpHost.messageQueue};

    var messageJSON = JSON.stringify(message);

    delete context.version;
    delete context.action;
    delete context.info;

    return new Promise(function(resolve,reject){

        function sendContext(){
            self.logger.debug(function(){ return 'publish: ' + messageJSON});

            self.mqttClient.publish('/1/l/' + context.qiot_thing_token,messageJSON,mqttOptions,function(err) {
                if (err) {
                    self.logger.error('publish error: ' + err);

                    reject(err);
                }
                else{
                    self.logger.debug('publish successful');

                    self.httpHost.messageQueue = [];

                    if (self.mailboxMessage) {
                        context = self.httpHost.updateContext(context,self.mailboxMessage);
                        self.mailboxMessage = null;
                    }

                    resolve(context);
                }
            });
        }

        self.ensureConnection(context).then(sendContext,reject);
    });
};

QiotMqttHost.prototype.ensureConnection = function(context){
    var self = this;

    if (self.mqttClient) return self.helpers.passThroughPromise(null);

    self.logger.debug('start MQTT client');

    var credentials = new Buffer(self.config.settings.qiot_account_token,'base64').toString().split(':');
    if (credentials.length != 2) return self.helpers.rejectionPromise('invalid credentials');

    return new Promise(function(resolve,reject){
        try {
            self.mqttClient = self.mqtt.connect('mqtt://' + (self.config.settings.host_dns   || 'api.qiot.io'),{
                clientId:   context.qiot_thing_token,
                username:   credentials[0],
                password:   credentials[1],
                keepalive:  self.config.settings.keepalive_interval,
                clean:      true
            });

            self.mqttClient.on('error',    function(err){ self.logger.error('mqtt error: ' + err) });
            self.mqttClient.on('reconnect',function()   { self.logger.debug('reconnected'); });
            self.mqttClient.on('close',    function()   { self.logger.debug('closed'); });
            self.mqttClient.on('offline',  function()   { self.logger.debug('offline'); });

            var mailboxTopic = '1/m/' + context.qiot_thing_token;
            self.mqttClient.subscribe(mailboxTopic,{qos: 0},function(err,granted){
                self.logger.debug(function(){ return 'subscribe: ' + JSON.stringify(err) + ':' + JSON.stringify(granted)});
            });

            self.mqttClient.on('connect',function(ack){
                self.logger.debug(function(){ return 'connected: ' + JSON.stringify(ack); });

                resolve(null);
            });

            self.mqttClient.on('message',function(topic,json){
                if (topic != mailboxTopic) return self.logger.debug('topic skipped: ' + topic);

                self.logger.debug(function(){ return 'mailbox message: ' + json; });

                self.mailboxMessage = self.helpers.safeParseJSON(json);
                self.emitter.emit('phonehome','wakeup');
            });

        } catch(err) {
            self.logger.error('connection error: ' + err);

            reject(err);
        }
    });
};

module.exports = QiotMqttHost;
