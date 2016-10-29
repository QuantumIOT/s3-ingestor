var _ = require('lodash');
var os = require('os');

var AWS = require('./aws');

//-------------- perform "phone home" action

function PhoneHome(emitter,version){
    var self = this;

    self.contextFile = 's3-ingestor-context.json';
    self.handlerLookup = {};
    
    self.emitter = emitter;
    self.version = version;
    
    // NOTE - delay loading for testability
    self.config = require('./config');
    self.helpers = require('./helpers');
    self.logger = require('./logger');

    self.aws = new AWS(self.config.settings);

    self.hostService = require(self.config.settings.host_service);

    self.eventFinished = null;
}

PhoneHome.prototype.resetPolicies = function(){
    var self = this;

    _.each(self.config.settings.policies,function(policy){ self.handlerForPolicy(policy).reset(); });
};

PhoneHome.prototype.handlePhoneHomeEvent = function(action){
    var self = this;

    self.clearCheckTimer();

    self.logger.message('phone home: ' + action);

    var context = self.readContext();
    context.version = self.version;
    context.action = action;
    context.info = self.readLocalInfo(action == 'startup');

    var processPoliciesImmediately = action == 'heartbeat' && context.state == 'configured';

    var setCheckTimerCallback = _.bind(self.setCheckTimer,self);

    function logPhoneHomeError(error){
        self.logger.error('phone home error - ' + error);
        self.setCheckTimer();
    }

    function respondToPhoneHome(){
        self.contactHost(context).then(function(output){
            var aws_keys = output.aws_keys;
            delete output.aws_keys;

            var newSettings = output.config;
            delete output.config;

            action = output.action;
            delete output.action;

            var oldState = context.state;
            self.helpers.saveJSON(self.contextFile,context = output);

            if (newSettings) self.config.update(newSettings);

            self.aws.optionallyResetS3(aws_keys,function(){
                if (action)
                    self.performHostAction(action,context).then(setCheckTimerCallback,logPhoneHomeError);
                else if (!processPoliciesImmediately || newSettings || oldState != context.state)
                    self.reapplyPolicies(context,setCheckTimerCallback,logPhoneHomeError);
                else
                    self.setCheckTimer();
            });
        },logPhoneHomeError);
    }

    (processPoliciesImmediately ? self.processPolicies(context) : self.passThroughPromise()).then(respondToPhoneHome,respondToPhoneHome);
};

PhoneHome.prototype.clearCheckTimer = function(){
    var self = this;

    self.checkTimer && clearTimeout(self.checkTimer);
    self.checkTimer = undefined;
};

PhoneHome.prototype.setCheckTimer = function(){
    var self = this;

    self.clearCheckTimer();
    self.checkTimer = setTimeout(function (){self.emitter.emit('phonehome','heartbeat');},self.config.settings.heartbeat_period * 1000);

    self.eventFinished && self.eventFinished();
};

PhoneHome.prototype.readLocalInfo = function(allInfo){
    return !allInfo ? {hostname: os.hostname()} : {
        hostname:   os.hostname(),
        hosttype:   os.type(),
        platform:   os.platform(),
        release:    os.release(),
        totalmem:   os.totalmem(),
        network:    os.networkInterfaces()
    };
};

PhoneHome.prototype.readContext = function(){
    return this.helpers.readJSON(this.contextFile,{'state': 'unregistered'},{'state': 'error'});
};

PhoneHome.prototype.contactHost = function(context){
    var self = this;

    var contextJSON = JSON.stringify({context: context});
    var options = {
        host : self.config.settings.host_dns,
        port : self.config.settings.host_port,
        path : self.config.settings.host_uri,
        method : 'POST',
        headers : {
            'Content-Type' : 'application/json',
            'Content-Length' : Buffer.byteLength(contextJSON,'utf8')
        }
    };
    return new Promise(function(resolve,reject){
        self.logger.debug(function() { return 'host input: ' + contextJSON; });
        var request = self.hostService.request(options,function(response){
            response.on('data',function(data){
                self.logger.debug(function() { return 'host output: ' + data.toString() });
                try {
                    resolve(JSON.parse(data.toString()));
                } catch(error) {
                    self.logger.error(error);
                    reject('host output error - ' + error);
                }
            });
        });
        request.on('error',reject);
        request.write(contextJSON);
        request.end();
    });
};

PhoneHome.prototype.performHostAction = function(action,context){
    var self = this;

    self.logger.message('perform host action: ' + action);
    return new Promise(function(resolve,reject){
        context.version = self.version;
        context.action = action;
        context.info = self.readLocalInfo();
        switch (action){
            case 'report':
                context.result = self.config.settings;
                break;
            case 'customizers':
                return self.downloadCustomizers(context,resolve,reject);
            case 'upgrade':
                return self.upgradeSelf(context,resolve,reject);
            case 'restart':
                return self.helpers.processExit(0);
            case 'reboot':
                return self.rebootSystem(context,resolve,reject);
        }
        self.contactHost(context).then(resolve,reject);
    });
};

PhoneHome.prototype.downloadCustomizers = function(context,resolve,reject){
    var self = this;

    var contents = [];
    var s3 = self.aws.configureS3();

    function reportError(err){
        self.logger.error('download customizers error - ' + err);
        context.action = context.action ? context.action + '+error' : 'error';
        context.error = err;
        self.contactHost(context).then(resolve,reject);
    }

    function processNextFile(){
        if (contents.length === 0) return self.reapplyPolicies(context,resolve,reject);

        var entry = contents.shift();
        self.logger.debug(function(){ return 'customizer: ' + entry.Key; });
        s3.getObject({Bucket: self.config.settings.s3_bucket,Key: entry.Key},function(err,data){
            if (err) return reportError(err);

            self.helpers.mkdir('./customizers/',function(err){
                var parts = entry.Key.split('/');
                self.helpers.writeFile('./customizers/' + parts[parts.length - 1],data.Body,function(err){
                    if (err) return reportError(err);

                    _.defer(processNextFile);
                });
            });
        })
    }

    s3.listObjects({Bucket: self.config.settings.s3_bucket,Prefix: self.config.settings.s3_customizers_prefix},function(err,data){
        if (err) return reportError(err);

        contents = data.Contents;
        self.logger.debug(function(){ return 'customizer count: ' + contents.length;});
        _.defer(processNextFile);
    });
};

PhoneHome.prototype.reapplyPolicies = function(context, resolve, reject){
    var self = this;

    if (context.state !== 'configured') return resolve(null);

    context.version = self.version;
    context.action = context.action ? 'ack+' + context.action : 'ack';
    context.info = self.readLocalInfo();
    self.processPolicies(context).then(function(){ self.contactHost(context).then(resolve,reject); },reject);
};

PhoneHome.prototype.upgradeSelf = function(context, resolve, reject){
    var self = this;

    self.helpers.processExec(self.config.settings.upgrade_command,function(error,stdout,stderr) {
        if (error) {
            context.action = 'upgrade+error';
            context.error = error;
        }

        self.contactHost(context).then(function(){
            if (error)
                resolve(null);
            else
                self.helpers.processExit(0);
        },reject);
    });
};

PhoneHome.prototype.rebootSystem = function(context, resolve, reject){
    var self = this;

    self.helpers.processExec(self.config.settings.reboot_command,function(error,stdout,stderr) {
        if (error) {
            context.action = 'reboot+error';
            context.error = error;
        }

        self.contactHost(context).then(resolve,reject);
    });
};

PhoneHome.prototype.processPolicies = function(context){
    var self = this;

    return new Promise(function(resolve,reject){
        self.logger.message('begin processing policies');

        var policies = _.clone(self.config.settings.policies || []);
        context.result = {added: 0,updated: 0,skipped: 0,ignored: 0,unchanged: 0};

        function processNextPolicy(){
            if (policies.length > 0)
                self.applyPolicy(context,policies.shift(),processNextPolicy,reject);
            else {
                self.logger.message('end processing policies');
                resolve(null);
            }
        }

        _.defer(processNextPolicy);
    });
};

PhoneHome.prototype.passThroughPromise = function(){
    return new Promise(function(resolve,reject){
        resolve(null);
    });
};

PhoneHome.prototype.applyPolicy = function(context,policy,resolve,reject){
    this.handlerForPolicy(policy).apply(context,_.extend({},this.config.settings,policy),resolve,reject);
};

PhoneHome.prototype.handlerForPolicy = function(policy){
    var self = this;

    var handlerKey = policy.handler || self.config.settings.default_policy_handler;
    if (self.handlerLookup[handlerKey]) return self.handlerLookup[handlerKey];

    var PolicyClass = self.helpers.requireLIB('policy-' + handlerKey);
    if (PolicyClass)
        self.handlerLookup[handlerKey] = new PolicyClass();
    else {
        self.logger.error('handler not found: ' + handlerKey);
        self.handlerLookup[handlerKey] = {
            reset: function(){ self.logger.message('no-op reset: ' + handlerKey); },
            apply: function(context,settings,resolve,reject){ self.logger.message('no-op apply: ' + handlerKey); resolve(null); }
        };
    }
    return self.handlerLookup[handlerKey];
};

module.exports = PhoneHome;
