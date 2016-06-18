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


function elementIsInArray(element, array) {
	return array.indexOf(element) !== -1;
}

function elementIsNotInArray(element, array) {
	return array.indexOf(element) === -1;
}

PolicyDownload.prototype.apply = function(context,settings,resolve,reject){
	var self = this;

	self.aws = new AWS(settings);
	self.context = context;
	self.settings = settings;
	self.resolve = resolve;
	self.reject = reject;

	/* This is where I am adding some logic to try to parse what is coming in inside settings */
	var s3 = self.aws.configureS3();
	self.s3KeysArray = _.clone(self.settings.policies[0]["file_keys"]);					// returns a list of file_keys that are specified
	self.localDirectoryPath= _.clone(self.settings.policies[0]["target_directory"]);	// returns a string that specifies the local target directory
	self.localFileNamesArray = _.clone(fs.readdirSync(self.localDirectoryPath));		// returns an array of files in the local target directory

	/**
	 There are two things we need to do to sync the bucket content with the local target directory
	 1. If there are files in S3 that are not in local target directory, we need to download them
	 2. If there are files in local target directory that are NOT in S3, we need to delete those local files
	 */

	// Build an object of key value pairs
	self.allKeysObject = {};
	self.newKeysObject = {};
	for (var i = 0; i < self.s3KeysArray.length; i++) {
		var splittedFileNamesArray = self.s3KeysArray[i].split("/");					// split the long keys by '/' as delimiter, returns an array of splitted strings
		var justFileNames = splittedFileNamesArray[splittedFileNamesArray.length-1];	// get just the file names (last string of the array)
		if (!(elementIsInArray(justFileNames,self.localFileNamesArray ))){
				self.newKeysObject[justFileNames] = self.s3KeysArray[i];
				}
		self.allKeysObject[justFileNames] = self.s3KeysArray[i];						// Create an object that has all mothership content anyway
	}
	console.log("\n===================================================================== ")
	console.log("HERE ARE ALL THE FILES THAT THE MOTHER SHIP HAS FOR ME ")
	console.log(self.allKeysObject);
	console.log("===================================================================== \n")

	console.log("\n===================================================================== ")
	console.log("HERE ARE JUST THE NEW FILES FROM THE MOTHER SHIP THAT I DON'T HAVE LOCALLY. I NEED TO DOWNLOAD THESE ")
	console.log(self.newKeysObject);
	console.log("===================================================================== \n")

	// Lets loop through the keys in newKeysObject and for each key lets download it and put it somewhere
	// Here I must check if the newKeysObject is empty.
	// If it is empty I should probably skip this for loop altogether
	for (var eachKey in self.newKeysObject){
		var params = {Bucket: self.settings.s3_bucket, Key: self.newKeysObject[eachKey]};
		var file = fs.createWriteStream(self.localDirectoryPath + eachKey);
		file.on('close', function(){
			console.log('Done!!')
		});
		s3.getObject(params).createReadStream().on('error', function(err){
			console.log(err);
		}).pipe(file);
		// console.log(self.localDirectoryPath + eachKey)
	}

	// REMOVE THE LOCAL FILES THAT ARE NO LONGER IN S3
	// Assuming that the download is complete. We need to delete files that we have locally but are no longer in S3
	// HAVE TO CHECK WITH THE ORIGNAL S3 Keys Array
	
	console.log("\n===================================================================== ")
	console.log("HERE ARE THE FILES THAT I HAVE LOCALLY BUT ARE NO LONGER IN S3, DELETING THEM NOW ");
	var localFileNamesArrayLength = self.localFileNamesArray.length;
	for (var j = 0; j < localFileNamesArrayLength; j++){
		if (!(self.localFileNamesArray[j] in self.allKeysObject)){
			console.log(self.localFileNamesArray[j])
			fs.unlink(self.localDirectoryPath + self.localFileNamesArray[j], function (err){
				if (err){
					return console.error(err);
				}
				console.log("FILE DELETED! ")
			})
		}
	}
	console.log("===================================================================== \n")

	console.log("\n===================================================================== ")
	console.log("HERE IS THE CONTENT OF MY LOCAL DIRECTORY AFTER SYNCING IS COMPLETE ");
	console.log(fs.readdirSync(self.localDirectoryPath));
	console.log("===================================================================== \n")

	/** Here is a alternative but naive approach, that I had previously used to sync local directory with s3 content. It involves
	 * creating a child process and executing a aws command called sync. It is just a one liner really
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