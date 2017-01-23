var _ = require('lodash');
var util = require('util');
var fs = require('fs');

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
        if (err) return self.recordError(err);

        var keyParts = key.split('/');
        var filename = keyParts[keyParts.length - 1];
        var lastTimestamp = self.lastTimestamps[key];
        var targetFilename = self.makeTargetFilename(filename);
        var s3FileSizeInBytes = parseInt(result.ContentLength);

        self.filesToDelete = _.difference(self.filesToDelete,[filename]);

        if (self.helpers.fileExists(targetFilename) && lastTimestamp && result.LastModified == lastTimestamp && self.helpers.fileSizeInBytes(targetFilename) == s3FileSizeInBytes) {
            self.logger.debug('...already downloaded');
            self.context.result.unchanged++;
            return _.defer(self.considerNextKeyCallback);
        }

        s3.getObject({Bucket: self.settings.s3_bucket,Key: key},function(err,data){
            if (err) return self.recordError(err);

            if (data.Body.length == s3FileSizeInBytes){
                self.helpers.writeFile(targetFilename,data.Body,function(err){
                    if (err) {return self.recordError(err);}

                    else if (fs.statSync(targetFilename)["size"] < s3FileSizeInBytes ){
                        self.helpers.unlinkSync(self.makeTargetFilename(targetFilename));
                        _.defer(self.considerNextKeyCallback);

                    }else{
                        self.logger.message('...downloaded: ' + targetFilename);

                        self.context.result.added++;

                        self.lastTimestamps[key] = result.LastModified;
                        _.defer(self.considerNextKeyCallback);}
                });
            }
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