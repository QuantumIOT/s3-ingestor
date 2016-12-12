var _ = require('lodash');
var util = require('util');

var AWS = require('./aws');

const DEFAULT_SOCKET_QUEUE = 's3-socket-queue';

function PolicySocket(){
    var self = this;

    self.checkQueueCallback = _.bind(self.checkQueue,self);
    self.logErrorCallback = _.bind(self.logError,self);

    // NOTE - delay loading for testability
    self.setupBase();
    self.redis = require('then-redis');
    self.net = require('net');
}

util.inherits(PolicySocket,require('./policy-base'));

PolicySocket.prototype.reset = function(){
    this.stopUpload();
};

PolicySocket.prototype.apply = function(context,settings,resolve,reject){
    var self = this;

    self.settings = settings;
    if (!self.settings.socket_queue) self.settings.socket_queue = DEFAULT_SOCKET_QUEUE;
    
    _.extend(context.result,self.stats || {});

    self.startUpload();

    self.ensureSocket();
    
    resolve(null);
};

PolicySocket.prototype.startUpload = function(){
    var self = this;
    
    if (self.s3) return self.logger.debug('upload already started');

    if (!self.aws) self.aws = new AWS(self.settings);
    
    self.s3 = self.aws.configureS3();
    self.redisClient = self.redis.createClient();

    _.defer(self.checkQueueCallback);

    self.logger.debug('upload started')
};

PolicySocket.prototype.stopUpload = function(){
    var self = this;

    if (self.s3) self.logger.debug('upload stopped');

    self.s3 = undefined;
};

PolicySocket.prototype.checkQueue = function(){
    var self = this;

    if (!self.s3) return self.logger.debug('queue checking stopped');

    self.logger.debug('call brpop');

    self.redisClient.brpop(self.settings.socket_queue,self.settings.queue_timeout || 15).catch(self.logErrorCallback).then(function(response){
        self.logger.debug(function(){ return 'brpop response: ' + JSON.stringify(response); });

        if (!response) return _.defer(self.checkQueueCallback);

        var queue = response[0];
        var payload = response[1];

        if (!self.s3) {
            self.logger.debug('put popped payload back');
            return self.redisClient.rpush(queue,payload);
        }

        var result = self.helpers.safeParseJSON(payload);
        var key = self.buildKey(self.settings,result.timestamp);
        if (!key) {
            self.logger.debug(function () { return 'ignore: ' + result.timestamp; });

            self.stats.ignored++;
            _.defer(self.checkQueueCallback);
        } else {
            self.logger.debug(function(){ return 'upload: ' + key;});

            self.s3.putObject({Bucket: self.settings.s3_bucket,Key: key,Body: result.data},function(err,data){
                if (!err)
                    self.stats.sent++;
                else {
                    self.logError(err);
                    self.logger.debug('put undelivered payload back');
                    self.redisClient.rpush(queue,payload);
                }
                _.defer(self.checkQueueCallback);
            });
        }
    });
};


PolicySocket.prototype.ensureSocket = function(){
    var self = this;

    if (self.socket) return;

    self.stats = {added: 0,skipped: 0,ignored: 0,sent: 0,errors: 0,status: 'pending'};

    var lastString = '';
    self.pushClient = self.redis.createClient();
    self.socket = new self.net.Socket();
    self.socket.on('data',function(data){
        var string = data.toString();
        if (string == lastString) {
            self.logger.debug('skip same data');

            self.stats.skipped++;
        } else {
            lastString = string;

            var payload = JSON.stringify({timestamp: self.helpers.isoTimestamp(),data: string});

            self.logger.debug(function(){ return 'call lpush: ' + payload; });

            self.pushClient.lpush(self.settings.socket_queue,payload).catch(self.logErrorCallback).then(function(){
                self.logger.debug('lpush success');

                self.stats.added++;
            })
        }
    });
    self.socket.on('close',function(){
        self.logger.debug('socket closed');

        self.stats.status = 'closed';
        self.socket = undefined;
    });
    self.socket.on('error',self.logErrorCallback);
    self.socket.setTimeout((self.settings.socket_timeout || 15) * 1000,function(){
        self.logError('timeout');

        self.socket.destroy();
    });
    self.socket.connect(self.settings.socket_port,self.settings.socket_host,function(){
        self.logger.debug('socket connected');

        self.stats.status = 'connected';
    });
};

PolicySocket.prototype.logError = function(error){
    var self = this;

    self.logger.error('socket error: ' + error);

    self.stats.status = 'error: ' + error;
    self.stats.errors++;
};

module.exports = PolicySocket;