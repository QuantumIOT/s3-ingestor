var _ = require('lodash');
var fs = require('fs');
var process = require('process');
var util = require('util');

var AWS = require('./aws');

function PolicyUpload(){
    var self = this;
    
    self.reset();

    self.processNextFileCallback = _.bind(self.processNextFile,self);

    // NOTE - delay loading for testability
    self.glob = require('glob');
    self.helpers = require('./helpers');
    self.logger = require('./logger');
}

util.inherits(PolicyUpload,require('./policy-base'));


PolicyUpload.prototype.reset = function(){
  this.lastSeenList = {};  
};

PolicyUpload.prototype.apply = function(context,settings,resolve,reject){
    var self = this;

    if (!self.aws) self.aws = new AWS(settings);

    self.context = context;
    self.settings = settings;
    self.resolve = resolve;
    self.reject = reject;
    self.currentFiles = [];
    
    if (typeof(settings.customizer) === 'string') {
        var customizerPath = process.cwd() + '/customizers/' + self.settings.customizer;
        if (fs.existsSync(customizerPath + '.js')) self.settings.customizer = require(customizerPath);
    }
    
    self.glob(settings.input_file_pattern || '**/*',function(err,files){
        if (err)
            self.reject(err);
        else {
            self.currentFiles = files;
            _.defer(self.processNextFileCallback);
        }
    })
};

PolicyUpload.prototype.recordError = function(err){
    var self = this;
    
    self.context.action = self.context.action ? self.context.action + '+error' : 'error';
    self.context.error = err;
    self.reject(err);
};

PolicyUpload.prototype.processOneFile = function(filename){
    var self = this;
    
    fs.stat(filename,function(err,stats){
        if (err) {
            self.logger.error('SKIP ERROR: ' + err);
            return _.defer(self.processNextFileCallback);
        }

        var key = undefined;
        var lastSeen = self.lastSeenList[filename];
        if (stats.isDirectory())
            _.defer(self.processNextFileCallback);
        else if (!(key = self.buildKey(self.settings,filename))) {
            self.context.result.ignored++;
            self.logger.debug(function () { return '... ignore: ' + filename });
            _.defer(self.processNextFileCallback);
        } else if (lastSeen && stats.mtime.valueOf() == lastSeen.mtime.valueOf() && stats.size == lastSeen.size) {
            self.context.result.unchanged++;
            self.logger.debug(function(){return '... unchanged: ' + filename});
            _.defer(self.processNextFileCallback);
        } else {
            var s3 = self.aws.configureS3();
            s3.listObjects({Bucket: self.settings.s3_bucket,Prefix: key},function(err,data){
                if (err)
                    self.recordError(err);
                else if (data.Contents.length > 0 && data.Contents[0].Size === stats.size) {
                    self.context.result.skipped++;
                    self.logger.debug(function(){return '... skip: ' + filename + ' => ' + key});
                    self.lastSeenList[filename] = stats;
                    _.defer(self.processNextFileCallback);
                } else {
                    var update = data.Contents.length > 0;
                    self.context.result[update ? 'updated' : 'added']++;
                    self.logger.message((update ? '... update: ' : '... add: ') + filename + ' => ' + key);
                    var stream = fs.createReadStream(filename);
                    stream.on('error',function(){ stream.emit('end'); });
                    s3.upload({Bucket: self.settings.s3_bucket,Key: key,Body: stream},function(err,data){
                        if (err)
                            self.recordError(err);
                        else {
                            self.lastSeenList[filename] = stats;
                            _.defer(self.processNextFileCallback);
                        }
                    });
                }
            });
        }
    });
};

PolicyUpload.prototype.processNextFile = function(){
    var self = this;
    
    if (self.currentFiles.length > 0)
        self.processOneFile(self.currentFiles.shift());
    else
        _.defer(self.resolve);
};

module.exports = PolicyUpload;