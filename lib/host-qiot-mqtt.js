var _ = require('lodash');

var START_RETRY_PERIOD  = 0.5;

function QiotMqttHost(emitter){
    var self = this;

    self.emitter        = emitter;
    self.mailboxMessage = null;
    self.retryPeriod    = START_RETRY_PERIOD;

    // NOTE - delay loading for testability
    self.mqtt           = require('mqtt');

    self.config         = require('./config');
    self.helpers        = require('./helpers');
    self.logger         = require('./logger');

    var QiotHttpHost    = require('./host-qiot-http');

    self.httpHost       = new QiotHttpHost(emitter);
}

QiotMqttHost.prototype.clearWatchdogTimer = function(){
    var self = this;

    self.watchdogTimer && clearTimeout(self.watchdogTimer);
    self.watchdogTimer = undefined;
};

QiotMqttHost.prototype.setWatchdogTimer = function(){
    var self = this;

    self.clearWatchdogTimer();
    if (self.emitter) self.watchdogTimer = setTimeout(function (){self.emitter.emit('phonehome','watchdog');},self.config.settings.heartbeat_period * 2 * 1000);
};

QiotMqttHost.prototype.registrationRequired = function(context){
    return this.httpHost.registrationRequired(context);
};

QiotMqttHost.prototype.contact = function(context){
    var self = this;

    if (self.registrationRequired(context)) return self.httpHost.contact(context);

    self.setWatchdogTimer();

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

                    if (!self.mailboxMessage)
                        resolve(context);
                    else {
                        var message = self.mailboxMessage;

                        self.mailboxMessage = null;

                        self.httpHost.ackMailboxMessage(context,message,resolve,reject);
                    }

                }
            });
        }

        self.ensureConnection(context).then(sendContext,reject);
    });
};

QiotMqttHost.prototype.ensureConnection = function(context){
    var self = this;

    if (self.mqttClient) return self.helpers.passThroughPromise(null);

    var credentials = new Buffer(self.config.settings.qiot_account_token,'base64').toString().split(':');
    if (credentials.length !== 2) return self.helpers.rejectionPromise('invalid credentials');

    return new Promise(function(resolve,reject){ self.startMqttClient(context.qiot_thing_token,credentials[0],credentials[1],resolve,reject); });
};

QiotMqttHost.prototype.startMqttClient = function(thingToken,username,password,resolve,reject) {
    var self = this;

    try {
        self.retryTimer && clearTimeout(self.retryTimer);
        self.retryTimer = undefined;

        self.logger.debug('start MQTT client');

        self.mqttClient = self.mqtt.connect({
            host:       self.config.settings.qiot_dns   || 'api.qiot.io',
            port:       self.config.settings.qiot_port  || 1883,
            clientId:   thingToken,
            username:   username,
            password:   password,
            keepalive:  self.config.settings.keepalive_interval,
            clean:      true
        });

        self.mqttClient.on('error',    function(err){ self.logger.error('mqtt error: ' + err) });
        self.mqttClient.on('reconnect',function()   { self.logger.debug('reconnected'); });
        self.mqttClient.on('close',    function()   { self.logger.debug('closed'); });

        self.mqttClient.on('offline',  function()   {
            self.logger.error('offline');

            self.mqttClient.end(true);
            self.mqttClient = null;

            reject && reject('offline');
            resolve = reject = null;

            self.retryMqttClient(thingToken,username,password);
        });

        var mailboxTopic = '1/m/' + thingToken;
        self.mqttClient.subscribe(mailboxTopic,{qos: 0},function(err,granted){
            self.logger.debug(function(){ return 'subscribe: ' + JSON.stringify(err) + ':' + JSON.stringify(granted)});
        });

        self.mqttClient.on('connect',function(ack){
            self.logger.debug(function(){ return 'connected: ' + JSON.stringify(ack); });

            self.retryPeriod    = START_RETRY_PERIOD;

            resolve && resolve(null);
            resolve = reject = null;
        });

        self.mqttClient.on('message',function(topic,json){
            if (topic !== mailboxTopic) return self.logger.debug('topic skipped: ' + topic);

            self.logger.debug(function(){ return 'mailbox message: ' + json; });

            self.mailboxMessage = self.helpers.safeParseJSON(json);
            self.emitter.emit('phonehome','wakeup');
        });

    } catch(err) {
        self.logger.error('connection error: ' + err);

        reject(err);
    }
};

QiotMqttHost.prototype.retryMqttClient = function(thingToken,username,password){
    var self = this;

    self.retryPeriod = Math.min(self.retryPeriod * 2,self.config.settings.heartbeat_period);

    self.logger.message('retry in ' + self.retryPeriod);

    self.retryTimer = setTimeout(function(){ self.startMqttClient(thingToken,username,password,self.testResolve,self.testReject); },self.retryPeriod * 1000);
};


module.exports = QiotMqttHost;
