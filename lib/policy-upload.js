var _ = require('lodash');
var fs = require('fs');
var util = require('util');

function PolicyUpload(){
    var self = this;
    
    self.reset();

    self.processNextFileCallback = _.bind(self.processNextFile,self);

    // NOTE - delay loading for testability
    self.setupBase();
    self.glob = require('qiot-glob');
}

util.inherits(PolicyUpload,require('./policy-base'));


PolicyUpload.prototype.reset = function(){
  this.lastSeenList = {};  
};

PolicyUpload.prototype.apply = function(context,settings,host,resolve,reject){
    var self = this;

    context.result = _.defaults(context.result,{added: 0,updated: 0,skipped: 0,ignored: 0,unchanged: 0,delayed: 0});

    self.setupApplyState(context,settings,host,resolve,reject);
    self.currentFiles = [];
    
    self.glob(settings.input_file_pattern || '**/*',function(err,files){
        if (err) return self.recordError(err);

        self.currentFiles = files;
        _.defer(self.processNextFileCallback);
    })
};

PolicyUpload.prototype.processOneFile = function(filename){
    var self = this;

    self.updateWatchdog();

    fs.stat(filename,function(err,stats){
        if (err) {
            self.logger.error('SKIP ERROR: ' + err);
            return _.defer(self.processNextFileCallback);
        }

        var key = undefined;
        var lastSeen = self.lastSeenList[filename];
        var checkCurrentFile = !self.settings.force_upload;
        if (stats.isDirectory()) {
            if (self.settings.delete_after_upload) self.removeEmptyDirectory(filename);

            _.defer(self.processNextFileCallback);
        } else if (!(key = self.buildKey(self.settings,filename))) {
            self.logger.debug(function () { return '... ignore: ' + filename });
            self.context.result.ignored++;
            _.defer(self.processNextFileCallback);
        } else if (checkCurrentFile && lastSeen && stats.size === lastSeen.size && stats.mtime.valueOf() === lastSeen.mtime.valueOf()) {
            self.logger.debug(function () { return '... unchanged: ' + filename });
            self.context.result.unchanged++;
            self.processLastSeen(filename, stats);
        } else if (self.settings.delay_upload && (self.helpers.timeNOW().valueOf() - stats.mtime.valueOf()) / 1000 < self.settings.delay_upload) {
            self.logger.debug(function () { return '... delayed: ' + filename });
            self.context.result.delayed++;
            _.defer(self.processNextFileCallback);
        } else {
            var s3 = self.aws.configureS3();
            s3.listObjects({Bucket: self.settings.s3_bucket,Prefix: key},function(err,data){
                if (err)
                    self.recordError(err);
                else if (checkCurrentFile && data.Contents.length > 0 && stats.size === data.Contents[0].Size && stats.mtime.valueOf() <= data.Contents[0].LastModified.valueOf()) {
                    self.logger.debug(function(){return '... skip: ' + filename + ' => ' + key});
                    self.context.result.skipped++;
                    self.processLastSeen(filename,stats);
                } else {
                    var update = data.Contents.length > 0;
                    self.logger.message((update ? '... update: ' : '... add: ') + filename + ' => ' + key);
                    self.context.result[update ? 'updated' : 'added']++;
                    var stream = fs.createReadStream(filename);
                    // istanbul ignore next
                    stream.on('error',function(){ stream.emit('end'); });
                    s3.upload({Bucket: self.settings.s3_bucket,Key: key,Body: stream},function(err,data){
                        if (err)
                            self.recordError(err);
                        else
                            self.processLastSeen(filename,stats,self.settings.delay_removal);
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

PolicyUpload.prototype.processLastSeen = function(filename,stats,delayRemoval){
    var self = this;

    if (delayRemoval || !(self.deleteFilename(filename) || self.moveFilename(filename)))
        self.lastSeenList[filename] = stats;

    _.defer(self.processNextFileCallback);
};

PolicyUpload.prototype.removeEmptyDirectory = function(filename){
    var self = this;

    try{
        self.helpers.rmdirSync(filename);

        self.logger.debug(function(){ return '... removed: ' + filename; });
    }catch(e){
        self.logger.debug(function(){ return '... not empty: ' + filename; });
    }
};

PolicyUpload.prototype.deleteFilename = function(filename){
    var self = this;

    if (!self.settings.delete_after_upload) return false;

    self.helpers.unlinkSync(filename);
    delete self.lastSeenList[filename];
    return true;
};

PolicyUpload.prototype.moveFilename = function(filename){
    var self = this;

    if (!self.settings.move_after_upload) return false;

    var stat = self.helpers.fileExists(self.settings.move_after_upload);
    if (!stat || !stat.isDirectory()){
        self.logger.error('invalid move directory: ' + self.settings.move_after_upload);
        self.settings.move_after_upload = null;
        return false;
    }

    var suffix = self.helpers.trimPrefix(filename,self.settings.input_remove_prefix || '');
    try{
        self.helpers.renameSync(filename,self.settings.move_after_upload + suffix);
        delete self.lastSeenList[filename];
        return true;
    }catch(err){
        self.logger.error('rename error: ' + err);
        return false;
    }
};

module.exports = PolicyUpload;