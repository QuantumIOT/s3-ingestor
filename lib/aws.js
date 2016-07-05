function AWS(settings){
    var self = this;
    self.s3 = undefined;
    self.settings = settings;
    
    // NOTE - delay loading for testability
    self.sdk = require('aws-sdk');
    self.helpers = require('./helpers');
    self.logger = require('./logger');

}

AWS.prototype.optionallyResetS3 = function(aws_keys,callback){
    var self = this;
    if (!aws_keys)
        callback();
    else {
        self.s3 = undefined;
        self.helpers.saveJSON(self.settings.aws_keys_file,self.settings.aws_keys = aws_keys);
        self.logger.message('waiting for IAM keys to become valid...');
        setTimeout(callback,self.settings.iam_reset_period * 1000)
    }

};

AWS.prototype.configureS3 = function(){
    var self = this;
    if (!self.s3) {
        if (!self.settings.aws_keys) self.settings.aws_keys = self.helpers.readJSON(self.settings.aws_keys_file,{},{});

        self.s3 = new self.sdk.S3({
            credentials: new self.sdk.Credentials(self.settings.aws_keys.access_key_id,self.settings.aws_keys.secret_access_key),
            httpOptions: {timeout: self.settings.s3_timeout}
        });
    }
    return self.s3;
};

module.exports = AWS;