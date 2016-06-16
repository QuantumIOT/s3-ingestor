/**
 * Currently this is just a copy of policy-upload.js file.
 * I need to
 */


var _ = require('lodash');
var fs = require('fs');
var process = require('process');
// added glob to list files
var glob = require("glob");


var AWS = require('./aws');

function PolicyDownload(){
	var self = this;

	self.reset();



	// NOTE - delay loading for testability
	self.glob = require('glob');
	self.helpers = require('./helpers');
	self.logger = require('./logger');
}

PolicyDownload.prototype.reset = function() {

};


function isIn(element, array) {
	return array.indexOf(element) > -1;
}

PolicyDownload.prototype.apply = function(context,settings,resolve,reject){
	var self = this;

	self.aws = new AWS(settings);

	self.context = context;
	self.settings = settings;
	self.resolve = resolve;
	self.reject = reject;

	/* This is where I am adding some logic to try to parse what is coming in inside settings */
	self.s3KeysArray = _.clone(self.settings.policies[0]["file_keys"]);					// returns a list of file_keys that are specified
	self.localDirectoryPath= _.clone(self.settings.policies[0]["target_directory"]);	// returns a string that specifies the local target directory
	self.localFileNamesArray = fs.readdirSync(self.localDirectoryPath);					// returns an array of files in the local target directory

	/**
	 There are two things we need to do to sync the bucket content with the local target directory
	 1. If there are files in S3 that are not in local target directory, we need to download them
	 2. If there are files in local target directory that are NOT in S3, we need to delete those local files
	 */
	console.log(self.s3KeysArray)

	// Build an object of key value pairs
	self.currentKeysObject = {};
	for (var i = 0; i < self.s3KeysArray.length; i++) {
		var splittedFileNamesArray = self.s3KeysArray[i].split("/");					// split the long keys by '/' as delimiter, returns an array of splitted strings
		var justFileNames = splittedFileNamesArray[splittedFileNamesArray.length-1];	// get just the file names (last string of the array)
		// if (!(isIn(justFileNames,self.localFileNamesArray ))){
		// 		self.currentKeysObject[justFileNames] = self.s3KeysArray[i];
		// 		}
		self.currentKeysObject[justFileNames] = self.s3KeysArray[i];
	}
	console.log("HERE ARE THE NEW FILES FROM THE MOTHERSHIP THAT I DON'T HAVE LOCALLY")
	console.log(self.currentKeysObject);

	console.log("THIS IS THE ACTUAL KEY I AM TRYING TO DOWNLOAD " +  self.s3KeysArray[0])
	var params = {Bucket: self.settings.s3_bucket,
					 Key: self.s3KeysArray[0]};

	var s3 = self.aws.configureS3();
	var file = fs.createWriteStream("/Users/krishna_qiot/Desktop/magic/test.jpg");
	file.on('close', function(){
		console.log('done');  //prints, file created
	});
	s3.getObject(params).createReadStream().on('error', function(err){
		console.log(err);
	}).pipe(file);

	console.log("Here is what I look like after updating ");
	console.log(fs.readdirSync(self.localDirectoryPath));
	// Assuming that the download is complete. We need to delete files that we have locally but are no longer in S3

	var localFileNamesArrayLength = self.localFileNamesArray.length;
	for (var j = 0; j <localFileNamesArrayLength; j++){
		if (!(self.localFileNamesArray[j] in self.currentKeysObject)){
			console.log("YAY FOUND IT " + self.localFileNamesArray[j])
			console.log(self.localDirectoryPath + self.localFileNamesArray[j])
			// fs.unlinkSync(self.localDirectoryPath + self.localFileNamesArray[j])
			fs.unlink(self.localDirectoryPath + self.localFileNamesArray[j], function(err){
				if (err){
					return console.error(err);
				}
				console.log("FILE DELETED");
			})
		}

	}

	console.log("HERE IS WHAT MY LOCAL DIRECTORY LOOKS AFTER SYNCING ");
	console.log(fs.readdirSync(self.localDirectoryPath));					// returns an array of files in the local target directory)


	/** Here is a naive but one liner approach, that I had previously used to sync local directory with s3 content
	 var sys = require('util')
	 var exec = require('child_process').exec;
	 var child;

	 child = exec("aws s3 sync s3://qiot-smg-datalake-dev-kbhattarai/Stores/Colleyville/Display_Left_Landscape_Normal/ /Users/krishna_qiot/Desktop/magic/ --delete --profile smg-dev", function (error, stdout, stderr) {

		sys.print('stdout: ' + stdout);
		sys.print('stderr: ' + stderr);
		if (error !== null) {
			console.log('exec error: ' + error);
		}
	});
	 */

	resolve(null);

};




module.exports = PolicyDownload;