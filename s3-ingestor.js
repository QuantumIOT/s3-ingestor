var _ = require('lodash');
var fs = require('fs');
var os = require('os');
var process = require('process');
var child_process = require('child_process');
var http = require('http');
var glob = require('glob');
var events = require('events');
var aws = require('aws-sdk');

var helpers = require('./lib/helpers');
var logger = require('./lib/logger');
var config = require ('./lib/config');

var CONTEXT_FILE = 's3-ingestor-context.json';
var VERSION = helpers.readJSON(__dirname + '/package.json',{version: 'UNKNOWN'},{version: 'ERROR'}).version;

var emitter = new events.EventEmitter();

//-------------- perform "phone home" action

var checkTimer = undefined;

function phoneHome(action){
    clearCheckTimer();

    var info = readLocalInfo(action == 'startup');
    if (!info) {
        logger.message('skip phone home - info not available...');
        setCheckTimer();
    } else {
        logger.message('phone home: ' + action);

        var context = readContext();
        context.version = VERSION;
        context.action = action;
        context.info = info;

        (context.state === 'configured' ? uploadFiles(context) : passThroughPromise()).catch(logPhoneHomeError).then(function(data){
            contactHost(context).catch(logPhoneHomeError).then(function(output){
                var aws_keys = output.aws_keys;
                delete output.aws_keys;

                var newSettings = output.config;
                delete output.config;

                action = output.action;
                delete output.action;

                var oldState = context.state;
                helpers.saveJSON(CONTEXT_FILE,context = output);

                if (aws_keys) resetS3(aws_keys);
                if (newSettings) config.update(newSettings);

                if (action)
                    performHostAction(action,context).then(setCheckTimer).catch(logPhoneHomeError);
                else if (context.state === oldState)
                    setCheckTimer();
                else
                    considerUploadAction(context,setCheckTimer,logPhoneHomeError);
            });
        });
    }
}

function logPhoneHomeError(error){
    logger.error('phone home error - ' + error);
    setCheckTimer();
}

function clearCheckTimer(){
    checkTimer && clearTimeout(checkTimer);
    checkTimer = undefined;
}

function setCheckTimer(){
    clearCheckTimer();
    checkTimer = setTimeout(function (){emitter.emit('phonehome','heartbeat');},config.settings.heartbeat_period * 1000);
}

function readLocalInfo(allInfo){

    return !allInfo ? {hostname: os.hostname()} : {
        hostname:   os.hostname(),
        hosttype:   os.type(),
        platform:   os.platform(),
        release:    os.release(),
        totalmem:   os.totalmem(),
        network:    os.networkInterfaces()
    };
}

function readContext(){
    return helpers.readJSON(CONTEXT_FILE,{'state': 'unregistered'},{'state': 'error'});
}

var hostService = require(config.settings.host_service);

function contactHost(context){
    var contextJSON = JSON.stringify({context: context});
    var options = {
        host : config.settings.host_dns,
        port : config.settings.host_port,
        path : config.settings.host_uri,
        method : 'POST',
        headers : {
            'Content-Type' : 'application/json',
            'Content-Length' : Buffer.byteLength(contextJSON,'utf8')
        }
    };
    return new Promise(function(resolve,reject){
        logger.debug(function() { return 'host input: ' + contextJSON; });
        var request = hostService.request(options,function(response){
            response.on('data',function(data){
                logger.debug(function() { return 'host output: ' + data.toString() });
                try {
                    resolve(JSON.parse(data.toString()));
                } catch(error) {
                    reject('host output error - ' + error);
                }
            });
        });
        request.on('error',reject);
        request.write(contextJSON);
        request.end();
    });
}

function performHostAction(action,context){
    logger.message('perform host action: ' + action);
    return new Promise(function(resolve,reject){
        context.version = VERSION;
        context.action = action;
        context.info = readLocalInfo();
        switch (action){
            case 'report':
                context.result = config;
                break;
            case 'customizers':
                return downloadCustomizers(context,resolve,reject);
            case 'upgrade':
                return upgradeSelf(context,resolve,reject);
        }
        contactHost(context).then(resolve).catch(reject);
    });
}

function downloadCustomizers(context,resolve,reject){
    var contents = [];
    var s3 = configureS3();

    function reportError(err){
        context.action = 'error';
        context.error = err;
        contactHost(context).then(resolve).catch(reject);
    }

    function processNextFile(){
        if (contents.length === 0) return considerUploadAction(context,resolve,reject);

        var entry = contents.shift();
        logger.debug(function(){ return 'customizer: ' + entry.Key; });
        s3.getObject({Bucket: config.settings.s3_bucket,Key: entry.Key},function(err,data){
            if (err) return reportError(err);

            fs.mkdir('./customizers/',function(err){
                var parts = entry.Key.split('/');
                fs.writeFile('./customizers/' + parts[parts.length - 1],data.Body,function(err){
                    if (err) return reportError(err);

                    _.defer(processNextFile);
                });
            });
        })
    }

    s3.listObjects({Bucket: config.settings.s3_bucket,Prefix: 'code/s3-ingestor/customizers/'},function(err,data){
        if (err) return reportError(err);

        contents = data.Contents;
        _.defer(processNextFile);
    });
}

function considerUploadAction(context, resolve, reject){
    if (context.state !== 'configured') return resolve(null);

    context.version = VERSION;
    context.action = 'upload';
    context.info = readLocalInfo();
    uploadFiles(context).catch(reject).then(function(){
        contactHost(context).then(resolve).catch(reject);
    });
}

function upgradeSelf(context,resolve,reject){
    child_process.exec(config.settings.upgrade_command,function(error,stdout,stderr) {
        if (error) {
            context.action = 'error';
            context.error = error;
        }

        contactHost(context).catch(reject).then(function(){
            if (error)
                resolve(null);
            else
                process.exit(0);
        });
    });
}

var lastSeenList = {};

function uploadFiles(context){
    return new Promise(function(resolve,reject){
        logger.message('begin uploading files...');

        var s3 = configureS3();
        var policies = _.clone(config.settings.policies || []);
        var currentPolicy = undefined;
        var currentFiles = undefined;
        context.result = {added: 0,updated: 0,skipped: 0,ignored: 0,unchanged: 0};

        function recordError(err){
            context.result.error = err;
            reject(err);
        }

        function buildkey(filename){
            var suffix = helpers.trimPrefix(filename,currentPolicy.input_remove_prefix || '');

            if (typeof(currentPolicy.customizer) === 'function')
                suffix = currentPolicy.customizer(suffix,config.settings);
            else if (currentPolicy.customizer)
                suffix = null;

            return suffix ? (currentPolicy.output_key_prefix || '') + suffix : null;
        }

        function processOneFile(filename){
            fs.stat(filename,function(err,stats){
                if (err) {
                    logger.error('SKIP ERROR: ' + err);
                    return _.defer(processNextFile);
                }
                var key = undefined;
                var lastSeen = lastSeenList[filename];
                if (stats.isDirectory())
                    _.defer(processNextFile);
                else if (!(key = buildkey(filename))) {
                    context.result.ignored++;
                    logger.debug(function () { return '... ignore: ' + filename });
                    _.defer(processNextFile);
                } else if (lastSeen && stats.mtime.valueOf() == lastSeen.mtime.valueOf() && stats.size == lastSeen.size) {
                    context.result.unchanged++;
                    logger.debug(function(){return '... unchanged: ' + filename});
                    _.defer(processNextFile);
                } else {
                    s3.listObjects({Bucket: config.settings.s3_bucket,Prefix: key},function(err,data){
                        if (err)
                            recordError(err);
                        else if (data.Contents.length > 0 && data.Contents[0].Size === stats.size) {
                            context.result.skipped++;
                            logger.debug(function(){return '... skip: ' + filename + ' => ' + key});
                            lastSeenList[filename] = stats;
                            _.defer(processNextFile);
                        } else {
                            var update = data.Contents.length > 0;
                            context.result[update ? 'updated' : 'added']++;
                            logger.message((update ? '... update: ' : '... add: ') + filename + ' => ' + key);
                            var stream = fs.createReadStream(filename);
                            stream.on('error',function(){ stream.emit('end'); });
                            s3.upload({Bucket: config.settings.s3_bucket,Key: key,Body: stream},function(err,data){
                                if (err)
                                    recordError(err);
                                else {
                                    lastSeenList[filename] = stats;
                                    _.defer(processNextFile);
                                }
                            });
                        }
                    });
                }
            });
        }

        function processNextFile(){
            if (currentFiles.length > 0)
                processOneFile(currentFiles.shift());
            else
                _.defer(processNextPolicy);
        }

        function processOnePolicy(policy){
            currentPolicy = policy;

            if (typeof(currentPolicy.customizer) === 'string') {
                var customizerPath = process.cwd() + '/customizers/' + currentPolicy.customizer;
                if (fs.existsSync(customizerPath + '.js')) currentPolicy.customizer = require(customizerPath);
            }

            glob(currentPolicy.input_file_pattern || '**/*',function(err,files){
                if (err)
                    reject(err);
                else {
                    currentFiles = files;
                    _.defer(processNextFile);
                }
            })
        }

        function processNextPolicy(){
            if (policies.length > 0)
                processOnePolicy(policies.shift());
            else {
                logger.message('end uploading files');
                resolve(null);
            }
        }

        _.defer(processNextPolicy);
    });
}

function passThroughPromise(){
    return new Promise(function(resolve,reject){
        resolve(null);
    });
}

//-------------- AWS functions

var s3;

function resetS3(aws_keys){
    s3 = undefined;
    helpers.saveJSON(config.settings.aws_keys_file,config.settings.aws_keys = aws_keys);
}

function configureS3(){
    if (!s3) {
        if (!config.settings.aws_keys) config.settings.aws_keys = helpers.readJSON(config.settings.aws_keys_file,{},{});

        s3 = new aws.S3({credentials: new aws.Credentials(config.settings.aws_keys.access_key_id,config.settings.aws_keys.secret_access_key)});
    }
    return s3;
}

//-------------- establish event scheme

emitter.on('startup',function(){
    logger.message('-----------------------------------------------------------');
    emitter.emit('phonehome','startup');

    var apiServer = http.createServer(function(req,res) {
        var context = readContext();
        var info = readLocalInfo();
        info.state = context.state || 'unknown';
        info.version = VERSION;

        logger.message('wakeup ' + JSON.stringify(info));

        res.writeHead(200, {'Content-Type': 'text/json'});
        res.end(JSON.stringify(info));

        lastSeenList = {};
        emitter.emit('phonehome','wakeup');
    });

    apiServer.listen(config.settings.api_port,'0.0.0.0');

    logger.message('Server running at http://0.0.0.0:' + config.settings.api_port);
});

emitter.on('phonehome',phoneHome);

emitter.emit('startup');

