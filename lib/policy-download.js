
var _ = require('lodash');
var fs = require('fs');
var process = require('process');

var AWS = require('./aws');

function PolicyDownload(){
	var self = this;

	self.reset();

	self.considerNextKeyCallback = _.bind(self.considerNextKey,self);

	// NOTE - delay loading for testability
	self.helpers = require('./helpers');
	self.logger = require('./logger');
}

PolicyDownload.prototype.reset = function() {
	this.lastTimestamps = {};
};

PolicyDownload.prototype.apply = function(context,settings,resolve,reject) {
	var self = this;

	self.aws = new AWS(settings);
	self.context = context;
	self.settings = settings;
	self.resolve = resolve;
	self.reject = reject;

	fs.mkdir(self.settings.target_directory,function(error){
		if (error) return reject(error);

		self.newTimestamps = {};
		self.filesToDelete = fs.readdirSync(self.settings.target_directory);
		self.keysToConsider = _.clone(self.settings.file_keys);

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

	var s3 = self.configureS3();
	s3.headObject({Bucket: self.settings.s3_bucket,Key: key},function(err,result){
		if (err) return self.reject(err);

		var keyParts = key.split('/');
		var filename = keyParts[keyParts.length - 1];
		var lastTimestamp = self.lastTimestamps[key];
		var targetFilename = self.makeTargetFilename(filename);

		if (fs.statsSync(targetFilename) && lastTimestamp && result.LastModified == lastTimestamp)
			return _.defer(self.considerNextKeyCallback);

		s3.getObject({Bucket: self.settings.s3_bucket,Key: key},function(err,data){
			if (err) return self.reject(err);

			fs.writeFile(targetFilename,data.Body,function(err){
				if (err) return self.reject(err);

				self.filesToDelete = _.difference(self.filesToDelete,[filename]);
				self.newTimestamps[key] = result.LastModified;
				_.defer(self.considerNextKeyCallback);
			});
		})
	});
};

PolicyDownload.prototype.deleteLeftoverFiles = function(){
	var self = this;

	try {
		self.lastTimestamps = self.newTimestamps();

		_.each(self.filesToDelete,function(filename){ fs.unlinkSync(self.makeTargetFilename(filename)) });

		self.resolve(null);
	} catch(error){
		self.reject(error);
	}
};

PolicyDownload.prototype.makeTargetFilename = function(filename){
	return this.settings.target_directory + '/' + filename;
};

module.exports = PolicyDownload;