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

PolicyUpload.prototype.apply = function(context,settings,resolve,reject){
    var self = this;

    context.result = _.defaults(context.result,{added: 0,updated: 0,skipped: 0,ignored: 0,unchanged: 0});

    self.setupApplyState(context,settings,resolve,reject);
    self.currentFiles = [];
    
    self.glob(settings.input_file_pattern || '**/*',function(err,files){
        if (err) return self.recordError(err);

        self.currentFiles = files;
        _.defer(self.processNextFileCallback);
    })
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
        } else if (lastSeen && stats.size === lastSeen.size && stats.mtime.valueOf() === lastSeen.mtime.valueOf()) {
            self.context.result.unchanged++;
            self.logger.debug(function(){return '... unchanged: ' + filename});
            _.defer(self.processNextFileCallback);
        } else {
            var s3 = self.aws.configureS3();
            s3.listObjects({Bucket: self.settings.s3_bucket,Prefix: key},function(err,data){
                if (err)
                    self.recordError(err);
                else if (data.Contents.length > 0 && stats.size === data.Contents[0].Size && stats.mtime.valueOf() <= data.Contents[0].LastModified.valueOf()) {
                    self.context.result.skipped++;
                    self.logger.debug(function(){return '... skip: ' + filename + ' => ' + key});
                    self.processLastSeen(filename,stats);
                } else {
                    var update = data.Contents.length > 0;
                    self.context.result[update ? 'updated' : 'added']++;
                    self.logger.message((update ? '... update: ' : '... add: ') + filename + ' => ' + key);
                    var stream = fs.createReadStream(filename);
                    // istanbul ignore next
                    stream.on('error',function(){ stream.emit('end'); });
                    s3.upload({Bucket: self.settings.s3_bucket,Key: key,Body: stream},function(err,data){
                        if (err)
                            self.recordError(err);
                        else
                            self.processLastSeen(filename,stats);

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

PolicyUpload.prototype.processLastSeen = function(filename,stats){
    var self = this;

    if (self.settings.delete_after_upload)
        self.helpers.unlinkSync(filename);
    else if (!self.moveFilename(filename))
        self.lastSeenList[filename] = stats;

    _.defer(self.processNextFileCallback);
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
        return true;
    }catch(err){
        self.logger.error('rename error: ' + err);
        return false;
    }
};

module.exports = PolicyUpload;