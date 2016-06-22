
var _ = require('lodash');
var fs = require('fs');
var process = require('process');

var glob = require("glob"); // added glob to list files
var sys = require('util');	// for run a system command
var exec = require('child_process').exec;	// to spawn a child process


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

	var s3 = self.aws.configureS3();
	// The implementation below for downloading files assumes that we get a JSON object from self.settings

	if (self.settings.policies[0]["handler"] === "download") {						// if the policy handler says 'download' then continue to do the following
		self.s3KeysArray = self.settings.policies[0]["file_keys"];					// returns a list of file_keys that are specified
		self.localDirectoryPath = self.settings.policies[0]["target_directory"];	// returns a string that specifies the local target directory
		self.localFileNamesArray = fs.readdirSync(self.localDirectoryPath);			// returns an array of files in the local target directory
		/**
		 There are two things we need to do to sync the bucket content with the local target directory
		 1. If there are files in S3 that are not in local target directory, we need to download them
		 2. If there are files in local target directory that are NOT in S3, we need to delete those local files
		 */
		// Build an object of key value pairs if there are any keys specified under policy.file-keys
		if (!(_.isEmpty(self.s3KeysArray))) {
			self.allKeysObject = {};	// This will hold all the files (keys) that are in the mothership
			self.newKeysObject = {};	// This will hold just the new/unique files that need to be downloaded
			for (var i = 0; i < self.s3KeysArray.length; i++) {
				var splittedFileNamesArray = self.s3KeysArray[i].split("/");					// split the long keys by '/' as delimiter, returns an array of splitted strings
				var justFileNames = splittedFileNamesArray[splittedFileNamesArray.length - 1];	// get just the file names (last string of the array)
				if (!(elementIsInArray(justFileNames, self.localFileNamesArray))) {				// check if files from s3 are in local target directory
					self.newKeysObject[justFileNames] = self.s3KeysArray[i];					// if unique put them in newKeysObject so that we can download them
				}
				self.allKeysObject[justFileNames] = self.s3KeysArray[i];						// Create an object that has all mothership content anyway
			}
	
			console.log("\n===================================================================== ");
			console.log("HERE ARE ALL THE FILES THAT THE MOTHER SHIP HAS FOR ME ");
			console.log(self.allKeysObject);
			console.log("===================================================================== \n");
	
			console.log("\n===================================================================== ");
			console.log("HERE ARE JUST THE NEW FILES FROM THE MOTHER SHIP THAT I DON'T HAVE LOCALLY. I NEED TO DOWNLOAD THESE ");
			console.log(self.newKeysObject);
			console.log("===================================================================== \n");
		}// end if
	
		// Lets loop through the keys in newKeysObject and for each key lets download it and put it in the local target directory
		// If it is not empty, lets try to download the files
		if (!(_.isEmpty(self.newKeysObject))) {
			for (var eachKey in self.newKeysObject){
				var params = {Bucket: self.settings.s3_bucket, Key: self.newKeysObject[eachKey]}; // *** THIS LINE NEEDS EXAMINATION ***
				var file = fs.createWriteStream(self.localDirectoryPath + eachKey);
				file.on('close', function(){
					console.log('Done!!');
				});
				s3.getObject(params).createReadStream().on('error', function(err){
					console.log(err);
				}).pipe(file);
				// console.log(self.localDirectoryPath + eachKey)
			}
		}// end if
	
		// REMOVE THE LOCAL FILES THAT ARE NO LONGER IN S3
		// Assuming that the download is complete. We need to delete files that we have locally but are no longer in S3
		// HAVE TO CHECK WITH THE ORIGNAL S3 Keys Array
		console.log("\n===================================================================== ");
		console.log("HERE ARE THE FILES THAT I HAVE LOCALLY BUT ARE NO LONGER IN S3, DELETING THEM NOW ");
		var localFileNamesArrayLength = self.localFileNamesArray.length;
		for (var j = 0; j < localFileNamesArrayLength; j++){
			if (!(self.localFileNamesArray[j] in self.allKeysObject)){
				console.log(self.localFileNamesArray[j])
				fs.unlink(self.localDirectoryPath + self.localFileNamesArray[j], function (err){
					if (err){
						return console.error(err);
					}
					console.log("FILE DELETED! ");
				})
			}
		}
		console.log("===================================================================== \n");
	
		console.log("\n===================================================================== ");
		console.log("HERE IS THE CONTENT OF MY LOCAL DIRECTORY AFTER SYNCING IS COMPLETE ");
		console.log(fs.readdirSync(self.localDirectoryPath));
		console.log("===================================================================== \n");
	}// end if

	/** AWS SYNC
	 * Here is a alternative but naive approach, that I had previously used to sync local directory with s3 content. It is
	 * just a aws command (one liner really). It assumes that all the files needed for a particular device (PI) are under a specified
	 * bucket/prefix on S3.
	 * This takes the entire content of a bucket/prefix and intelligently downloads them and put them at a certain location.
	 * It automatically takes care of timestamp checks and is also capable of removing content on both sides to maintain "sync"
	 * For example, here mybucket/prefix is: qiot-smg-datalake-dev-kbhattarai/Stores/Colleyville/Display_Left_Landscape_Normal
	 * my target directory is: /Users/krishna_qiot/Desktop/magic/
	 * and --delete means, delete local files that are no longer in the specified s3 bucket/prefix
	 */
	
	//  var child;
	//  child = exec("aws s3 sync s3://qiot-smg-datalake-dev-kbhattarai/Stores/Colleyville/Display_Left_Landscape_Normal/ /Users/krishna_qiot/Desktop/magic/ --delete --profile smg-dev", function (error, stdout, stderr) {
	// 	sys.print('stdout: ' + stdout);
	// 	sys.print('stderr: ' + stderr);
	// 	if (error !== null) {
	// 		console.log('exec error: ' + error);
	// 	}
	// });
	
	resolve(null);
};

module.exports = PolicyDownload;