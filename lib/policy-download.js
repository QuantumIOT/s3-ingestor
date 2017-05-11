var _ = require('lodash');
var util = require('util');

function PolicyDownload(){
    var self = this;

    self.setupBase();

    self.reset();

    self.considerNextKeyCallback = _.bind(self.considerNextKey,self);
}

util.inherits(PolicyDownload,require('./policy-base'));


PolicyDownload.prototype.reset = function() {
    this.lastTimestamps = {};
};

PolicyDownload.prototype.apply = function(context,settings,resolve,reject) {
    var self = this;

    context.result = _.defaults(context.result,{added: 0,unchanged: 0,deleted: 0});

    self.setupApplyState(context,settings,resolve,reject);
    self.ensureRecordError(function(){
        if (!self.helpers.fileExists(self.settings.target_directory))
            self.helpers.mkdirSync(self.settings.target_directory);

        self.filesToDelete = self.helpers.readdirSync(self.settings.target_directory);
        self.keysToConsider = _.clone(self.settings.file_keys) || [];

        _.defer(self.considerNextKeyCallback);
    });
};

PolicyDownload.prototype.considerNextKey = function() {
    var self = this;

    if (self.keysToConsider.length > 0)
        self.considerOneKey(self.keysToConsider.shift());
    else
        self.deleteLeftoverFiles();
};

PolicyDownload.prototype.considerOneKey = function(key){
    var self = this;
    
    self.logger.debug(function(){return 'consider: ' + key});

    var s3 = self.aws.configureS3();
    s3.headObject({Bucket: self.settings.s3_bucket,Key: key},function(err,result){

        function logError(err){
            self.logger.error('download error: ' + err + ' ' + _.last(key.split("/")));
            self.context.action = self.context.action ? self.context.action + '+error' : 'error';
            self.context.error = err;
            return _.defer(self.considerNextKeyCallback);
        }

        if (err) return logError(err);

        var keyParts = key.split('/');
        var filename = keyParts[keyParts.length - 1];
        var lastTimestamp = self.lastTimestamps[key];
        var targetFilename = self.makeTargetFilename(filename);
        var s3FileSizeInBytes = parseInt(result.ContentLength);

        self.filesToDelete = _.difference(self.filesToDelete,[filename]);


        var oldStats = self.helpers.fileExists(targetFilename);
        if (oldStats) {
            if (!lastTimestamp || (oldStats.size === s3FileSizeInBytes && result.LastModified === lastTimestamp)) {
                self.logger.debug('...already downloaded');
                self.context.result.unchanged++;
                self.lastTimestamps[key] = result.LastModified;
                return _.defer(self.considerNextKeyCallback);
            }

            self.helpers.unlinkSync(targetFilename);
        }

        s3.getObject({Bucket: self.settings.s3_bucket,Key: key},function(err,data){
            if (err) return logError(err);

            var tempFilename = targetFilename + '.tmp';
            self.helpers.writeFile(tempFilename, data.Body, function(err){
                if (err) return logError(err);

                var newStats = self.helpers.fileExists(tempFilename);
                if (!newStats || newStats.size !== s3FileSizeInBytes) {
                    self.helpers.unlinkSync(tempFilename);
                    return logError('Invalid file size in S3');
                }

                self.helpers.renameSync(tempFilename, targetFilename);
                self.logger.message('...downloaded: ' + targetFilename);
                self.context.result.added++;
                self.lastTimestamps[key] = result.LastModified;

                _.defer(self.considerNextKeyCallback);
            })
        })
    });
};

PolicyDownload.prototype.deleteLeftoverFiles = function(){
    var self = this;

    self.ensureRecordError(function(){
        _.each(self.filesToDelete,function(filename){
            self.logger.debug(function(){ return 'delete: ' + filename; });
            self.helpers.unlinkSync(self.makeTargetFilename(filename));

            self.context.result.deleted++;
        });

        self.resolve(null);
    });
};

PolicyDownload.prototype.ensureRecordError = function(callback){
    try { callback(); }catch(error){ this.recordError(error); }
};

PolicyDownload.prototype.makeTargetFilename = function(filename){
    return this.settings.target_directory + '/' + filename;
};

module.exports = PolicyDownload;