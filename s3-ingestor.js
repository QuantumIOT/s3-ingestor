var _ = require('lodash');
var fs = require('fs');
var os = require('os');
var process = require('process');
var http = require('http');
var glob = require('glob');
var events = require('events');
var aws = require('aws-sdk');

var helpers = require('./lib/helpers');
var logger = require('./lib/logger');
var config = require ('./lib/config');

var CONTEXT_FILE = 's3-ingestor-context.json';
var VERSION = helpers.readJSON('package.json',{version: 'UNKNOWN'},{version: 'ERROR'}).version;

var emitter = new events.EventEmitter();

//-------------- perform "phone home" action

var checkTimer = undefined;

function phoneHome(action){
    clearCheckTimer();

    var interfaces = readInterfaces();
    if (!interfaces) {
        logger.message('skip phone home - interfaces not available...');
        setCheckTimer();
    } else {
        logger.message('phone home: ' + action);

        var context = readContext();
        context.version = VERSION;
        context.action = action;

        context.lan = interfaces.lan;
        context.wan = interfaces.wan;

        console.log(interfaces);

        (context.state === 'configured' ? uploadFiles(context) : passThroughPromise()).catch(logPhoneHomeError).then(function(data){
            contactHost(context).catch(logPhoneHomeError).then(function(output){
                var aws_keys = output.aws_keys;
                delete output.aws_keys;

                action = output.action;
                delete output.action;

                var oldState = context.state;
                helpers.saveJSON(CONTEXT_FILE,context = output);

                if (aws_keys) resetS3(aws_keys);

                if (action)
                    performHostAction(action,context).then(setCheckTimer).catch(logPhoneHomeError);
                else if (context.state === oldState)
                    setCheckTimer();
                else
                    uploadFiles(context).catch(logPhoneHomeError).then(function(data){
                        context.action = 'upload';
                        contactHost(context).then(setCheckTimer).catch(logPhoneHomeError);
                    });
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
    checkTimer = setTimeout(function (){emitter.emit('phonehome','heartbeat');},config.heartbeat_period * 1000);
}

function readInterfaces(){
    var interfaces = os.networkInterfaces();
    return {'lan': findFirstMAC(interfaces[config.lan_port]), 'wan': findFirstMAC(interfaces[config.wan_port])}
}

function findFirstMAC(options){
    var result = undefined;
    _.each(options,function(option,index){
        if (!result && option.mac) result = option;
    });
    return result;
}

function readContext(){
    return helpers.readJSON(CONTEXT_FILE,{'state': 'unregistered'},{'state': 'error'});
}

var hostService = require(config.host_service);

function contactHost(context){
    var contextJSON = JSON.stringify({context: context});
    var options = {
        host : config.host_dns,
        port : config.host_port,
        path : config.host_uri,
        method : 'POST',
        headers : {
            'Content-Type' : 'application/json',
            'Content-Length' : Buffer.byteLength(contextJSON,'utf8')
        }
    };
    console.log(options);
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
        context.action = action;
        contactHost(context)
            .then(function(){
                resolve(null); // TODO figure this out...
            })
            .catch(reject);
    });
}

var lastSeenList = {};

function uploadFiles(context){
    return new Promise(function(resolve,reject){
        logger.message('begin uploading files...');

        var s3 = configureS3();
        var policies = _.clone(config.policies);
        var currentPolicy = undefined;
        var currentFiles = undefined;
        context.result = {added: 0,updated: 0,skipped: 0,ignored: 0,unchanged: 0};

        function buildkey(filename){
            var suffix = helpers.trimPrefix(filename,currentPolicy.input_remove_prefix || '');

            if (currentPolicy.customizer) suffix = currentPolicy.customizer(suffix);

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
                    s3.listObjects({Bucket: config.s3_bucket,Prefix: key},function(err,data){
                        if (err)
                            reject(err);
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
                            s3.upload({Bucket: config.s3_bucket,Key: key,Body: stream},function(err,data){
                                if (err)
                                    reject(err);
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

            if (typeof(currentPolicy.customizer) === 'string') currentPolicy.customizer = require(process.cwd() + '/customizers/' + currentPolicy.customizer);

            glob(currentPolicy.input_file_pattern,function(err,files){
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

var s3;

function resetS3(aws_keys){
    s3 = undefined;
    helpers.saveJSON(config.aws_keys_file,config.aws_keys = aws_keys);
}

function configureS3(){
    if (!s3) {
        if (!config.aws_keys) config.aws_keys = helpers.readJSON(config.aws_keys_file,{},{});

        s3 = new aws.S3({credentials: new aws.Credentials(config.aws_keys.access_key_id,config.aws_keys.secret_access_key)});
    }
    return s3;
}

//-------------- establish event scheme

emitter.on('startup',function(){
    logger.message('-----------------------------------------------------------');
    emitter.emit('phonehome','startup');

    var apiServer = http.createServer(function(req,res) {
        var context = readContext();
        var interfaces = readInterfaces();
        interfaces.state = context.state || 'unknown';
        interfaces.version = VERSION;

        logger.message('wakeup ' + JSON.stringify(interfaces));

        res.writeHead(200, {'Content-Type': 'text/json'});
        res.end(JSON.stringify(interfaces));

        lastSeenList = {};
        emitter.emit('phonehome','wakeup');
    });

    apiServer.listen(config.api_port,'0.0.0.0');

    logger.message('Server running at http://0.0.0.0:' + config.api_port);
});

emitter.on('phonehome',phoneHome);

emitter.emit('startup');

