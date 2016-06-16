var _ = require('lodash');
var fs = require('fs');
var os = require('os');
var util = require('util');

var AWS = require('./aws');

const DEFAULT_SOCKET_QUEUE = 's3-socket-queue';

function PolicySocket(){
    var self = this;

    self.reset();
    
    self.checkQueueCallback = _.bind(self.checkQueue,self);
    self.logErrorCallback = _.bind(self.logError,self);

    // NOTE - delay loading for testability
    self.helpers = require('./helpers');
    self.logger = require('./logger');
}

util.inherits(PolicySocket,require('./policy-base'));

PolicySocket.prototype.reset = function(){
    self.stopUpload();
};

PolicySocket.prototype.apply = function(context,settings,resolve,reject){
    var self = this;

    self.settings = settings;
    if (!self.settings.socket_queue) self.settings.socket_queue = DEFAULT_SOCKET_QUEUE;
    
    _.extend(context.result,self.stats || {});

    self.ensureSocket();

    self.startUpload();
    
    resolve(null);
};

PolicySocket.prototype.startUpload = function(){
    var self = this;
    
    if (self.s3) return;

    if (!self.aws) self.aws = new AWS(self.settings);
    
    self.s3 = self.aws.configureS3();

    _.defer(self.checkQueueCallback);
};

PolicySocket.prototype.stopUpload = function(){
    this.s3 = undefined;
};

PolicySocket.prototype.checkQueue = function(){
    var self = this;

    if (!self.s3) return;

    self.ensureRedis().brpop(self.settings.socket_queue,(self.settings.queue_timeout || 15) * 1000).catch(self.logErrorCallback).then(function(payload){
        if (!self.s3)
            return self.ensureRedis().rpush(self.settings.socket_queue,payload);

        var result = JSON.parse(payload);
        var key = self.buildKey(self.settings,result.timestamp);
        if (!key) {
            self.logger.debug(function () { return 'ignore: ' + result.timestamp; });
            
            self.stats.ignored++;
            _.defer(self.checkQueueCallback);
        } else {
            self.logger.debug(function(){ return 'upload: ' + key;});

            self.s3.putObject({Bucket: self.settings.s3_bucket,Key: key,Body: result.data},function(err,data){
                if (err)
                    self.logError(err);
                else {
                    self.stats.sent++;
                    _.defer(self.checkQueueCallback);
                }
            });
        }
    });
};


PolicySocket.prototype.ensureSocket = function(){
    var self = this;

    if (self.socket) return;

    self.stats = {added: 0,skipped: 0,ignored: 0,sent: 0,errors: 0,status: 'pending'};

    var lastString = '';
    var Socket = require('net').Socket;
    self.socket = new Socket();
    self.socket.on('data',function(data){
        var string = data.toString();
        if (string == lastString) {
            self.logger.debug('skip same data');

            self.stats.skipped++;
        } else {
            lastString = string;

            var payload = JSON.stringify({timestamp: new Date().toISOString(),data: string});

            self.logger.debug(function(){ return 'payload: ' + payload; });

            self.ensureRedis().lpush(DEFAULT_SOCKET_QUEUE,payload)
                .then(function(){ self.stats.added++; })
                .catch(self.logErrorCallback);
        }
    });
    self.socket.on('close',function(){
        self.logger.debug('socket closed');

        self.stats.status = 'closed';
        self.socket = undefined;
    });
    self.socket.on('error',self.logErrorCallback);
    self.socket.setTimeout((settings.socket_timeout || 15) * 1000,function(){
        self.logError('timeout');
    });
    self.socket.connect(self.settings.socket_port,self.settings.socket_host,function(){
        self.logger.debug('socket connected');

        self.stats.status = 'connected';
    });
};

PolicySocket.prototype.ensureRedis = function(){
    var self = this;

    if (!self.redisClient)
        self.redisClient = require('then-redis').createClient();

    return self.redisClient;
};

PolicySocket.prototype.logError = function(error){
    var self = this;

    self.logger.error('error: ' + error);

    self.stats.status = 'error: ' + error;
    self.stats.errors++;
};

module.exports = PolicySocket;