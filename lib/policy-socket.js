var _ = require('lodash');
var fs = require('fs');

const SOCKET_QUEUE = 's3-socket-queue';

function PolicySocket(){
    var self = this;

    self.reset();

    // NOTE - delay loading for testability
    self.helpers = require('./helpers');
    self.logger = require('./logger');
}

PolicySocket.prototype.reset = function(){
};

PolicySocket.prototype.apply = function(context,settings,resolve,reject){
    var self = this;

    self.settings = settings;

    _.extend(context.result,self.stats || {});
    context.data = [];

    function checkQueue(){
        self.ensureRedis().rpop(SOCKET_QUEUE).catch(reject).then(function(payload){
            if (!payload) return resolve(null);
            
            context.data.push(JSON.parse(payload));
            
            _.defer(checkQueue);
        });
    }
    
    _.defer(checkQueue);

    if (self.socket) return;
    
    self.stats = {data: 0,errors: 0,status: 'pending'};

    var lastString = '';
    var Socket = require('net').Socket;
    self.socket = new Socket();
    self.socket.on('data',function(data){
        var string = data.toString();
        if (string == lastString)
            self.logger.debug('skip same data');
        else {
            lastString = string;
            
            var payload = JSON.stringify({timestamp: new Date().toISOString(),data: string});
            
            self.logger.debug(function(){ return 'payload: ' + payload; });
            
            self.ensureRedis().lpush(SOCKET_QUEUE,payload)
                .then(function(){ self.stats.data++; })
                .catch(function(error){
                    self.logger.error('redis error: ' + error);
                    
                    self.stats.status = 'error: ' + error;
                    self.stats.errors++;
                });
        }
    });
    self.socket.on('close',function(){
        self.logger.debug('socket closed');
        
        self.stats.status = 'closed';
        self.socket = undefined;
    });
    self.socket.on('error',function(error){
        self.logger.error('socket error: ' + error);
        
        self.stats.status = 'error: ' + error;
        self.stats.errors++;
    });
    self.socket.setTimeout(settings.socket_timeout || 15 * 1000,function(){
        self.logger.error('socket timeout');
        
        self.stats.status = 'error: timeout';
        self.stats.errors++;
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

module.exports = PolicySocket;