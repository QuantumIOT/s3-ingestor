var _ = require('lodash');
var test = require('../test');

var os = require('os');
var events = require('events');

var PhoneHome = require(process.cwd() + '/lib/phone-home');

describe('PhoneHome',function() {

    var config = null;
    var emitter = null;
    var oldPolicies = null;
    var oldHeartbeatPeriod = null;

    beforeEach(function () {
        var configModule = process.cwd() + '/lib/config';

        test.mockery.enable();
        test.mockery.warnOnReplace(false);
        test.mockery.registerAllowables(['./aws','./config','lodash',configModule]);
        test.mockery.registerMock('aws-sdk', test.mockAwsSdk);
        test.mockAwsSdk.resetMock();
        test.mockery.registerMock('https', test.mockHTTPS);
        test.mockHTTPS.resetMock();
        test.mockery.registerMock('./helpers', test.mockHelpers);
        test.mockHelpers.resetMock();
        test.mockery.registerMock('./logger', test.mockLogger);
        test.mockLogger.resetMock();

        config = require(configModule);
        test.mockHelpers.resetMock();

        test.mockLogger.debugging = true;
        emitter = new events.EventEmitter();
        oldPolicies = config.settings.policies;
        oldHeartbeatPeriod = config.settings.heartbeat_period;
        config.settings.heartbeat_period = 0.01;
    });

    afterEach(function () {
        test.mockLogger.debugging = false;
        config.settings.policies = oldPolicies;
        config.settings.heartbeat_period = oldHeartbeatPeriod;
        test.mockAwsSdk.checkMockState();
        test.mockHelpers.checkMockFiles();
        test.mockLogger.checkMockLogEntries();
        test.mockery.deregisterAll();
        test.mockery.disable();
    });
    
    describe('resetPolicies',function(){
        it('should call the reset method on any known policy handlers',function(){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            var handler = phoneHome.handlerForPolicy({handler: 'test'});
            test.mockLogger.checkMockLogEntries(['ERROR - handler not found: test']);

            config.settings.policies = [{handler: 'test'}];
            phoneHome.resetPolicies();
            test.mockLogger.checkMockLogEntries(['no-op reset: test']);
        })
    });

    describe('processPolicies',function(){
        it('should accept missing policies',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            delete config.settings.policies;

            phoneHome.processPolicies({})
                .catch(function(){ true.should.not.be.ok; done(); })
                .then(function(){
                    test.mockLogger.checkMockLogEntries([
                        'begin processing policies',
                        'end processing policies'
                    ]);
                    done();
                });
        });
    });

    describe('handlerForPolicy',function(){
        it('should default to the upload policy',function(){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            var handler = phoneHome.handlerForPolicy({handler: 'test'});
            test.mockLogger.checkMockLogEntries(['ERROR - handler not found: test']);

            test.mockHelpers.filesToRequire['policy-upload'] = function () { this.reset = handler.reset; this.apply = handler.apply; };

            phoneHome.handlerForPolicy({});

            test.mockHelpers.checkMockFiles([],[],['policy-upload']);
        });
    });
    
    describe('handlePhoneHomeEvent',function(){
        it('should do nothing on startup unless context state is configured',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            phoneHome.handlePhoneHomeEvent('startup');

            test.mockHTTPS.deferAfterEnd = function() {
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data('{"state":"test"}');
            };

            phoneHome.eventFinished = function(){
                var infoString = JSON.stringify(phoneHome.readLocalInfo(true));
                test.mockLogger.checkMockLogEntries([
                    'phone home: startup',
                    'DEBUG - host input: {"context":{"state":"unregistered","version":"TEST-VERSION","action":"startup","info":' + infoString + '}}',
                    'DEBUG - host output: {"state":"test"}'
                ]);
                test.mockHTTPS.checkWritten(['{"context":{"state":"unregistered","version":"TEST-VERSION","action":"startup","info":' + infoString + '}}',null]);
                test.mockHelpers.checkMockFiles([[phoneHome.contextFile,'default']],[[phoneHome.contextFile,{state: 'test'}]]);

                (!!phoneHome.checkTimer).should.be.ok;

                emitter.on('phonehome',function(action){
                    phoneHome.clearCheckTimer();
                    action.should.eql('heartbeat');
                    done();
                });

            };
        });

        it('should do nothing on hearbeat unless context state is configured',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            phoneHome.handlePhoneHomeEvent('heartbeat');

            test.mockHTTPS.deferAfterEnd = function() {
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data('{"state":"test"}');
            };

            phoneHome.eventFinished = function(){
                var infoString = JSON.stringify(phoneHome.readLocalInfo(false));
                test.mockLogger.checkMockLogEntries([
                    'phone home: heartbeat',
                    'DEBUG - host input: {"context":{"state":"unregistered","version":"TEST-VERSION","action":"heartbeat","info":' + infoString + '}}',
                    'DEBUG - host output: {"state":"test"}'
                ]);
                test.mockHTTPS.checkWritten(['{"context":{"state":"unregistered","version":"TEST-VERSION","action":"heartbeat","info":' + infoString + '}}',null]);
                test.mockHelpers.checkMockFiles([[phoneHome.contextFile,'default']],[[phoneHome.contextFile,{state: 'test'}]]);

                (!!phoneHome.checkTimer).should.be.ok;

                emitter.on('phonehome',function(action){
                    phoneHome.clearCheckTimer();
                    action.should.eql('heartbeat');
                    done();
                });

            };
        });

        it('should do catch an error if unable to connect to the server',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            phoneHome.handlePhoneHomeEvent('startup');

            test.mockHTTPS.deferAfterEnd = function() {
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data('{');
            };

            phoneHome.eventFinished = function(){
                var infoString = JSON.stringify(phoneHome.readLocalInfo(true));
                test.mockLogger.checkMockLogEntries([
                    'phone home: startup',
                    'DEBUG - host input: {"context":{"state":"unregistered","version":"TEST-VERSION","action":"startup","info":' + infoString + '}}',
                    'DEBUG - host output: {',
                    'ERROR - SyntaxError: Unexpected end of input',
                    'ERROR - phone home error - host output error - SyntaxError: Unexpected end of input'
                ]);
                test.mockHTTPS.checkWritten(['{"context":{"state":"unregistered","version":"TEST-VERSION","action":"startup","info":' + infoString + '}}',null]);
                test.mockHelpers.checkMockFiles([[phoneHome.contextFile,'default']]);

                (!!phoneHome.checkTimer).should.be.ok;
                phoneHome.clearCheckTimer();
                done();
            };
        });

        it('should apply policies before sending heartbeat when configured',function(done){
            config.settings.policies = [{handler: 'test'}];

            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            test.mockHelpers.filesToRead[phoneHome.contextFile] = {state: 'configured'};

            phoneHome.handlePhoneHomeEvent('heartbeat');

            test.mockHTTPS.deferAfterEnd = function(){
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data('{"state":"configured"}');
            };

            phoneHome.eventFinished = function(){
                test.mockLogger.checkMockLogEntries([
                    'phone home: heartbeat',
                    'begin processing policies',
                    'ERROR - handler not found: test',
                    'no-op apply: test',
                    'end processing policies',
                    'DEBUG - host input: {"context":{"state":"configured","version":"TEST-VERSION","action":"heartbeat","info":{"hostname":"' + os.hostname() + '"},"result":{"added":0,"updated":0,"skipped":0,"ignored":0,"unchanged":0}}}',
                    'DEBUG - host output: {"state":"configured"}'
                ]);

                test.mockHTTPS.checkWritten(['{"context":{"state":"configured","version":"TEST-VERSION","action":"heartbeat","info":{"hostname":"' + os.hostname() + '"},"result":{"added":0,"updated":0,"skipped":0,"ignored":0,"unchanged":0}}}',null]);
                test.mockHelpers.checkMockFiles([[phoneHome.contextFile,'success']],[[phoneHome.contextFile,{state: 'configured'}]]);

                (!!phoneHome.checkTimer).should.be.ok;
                phoneHome.clearCheckTimer();
                done();
            };
        });

        it('should report back the settings if not configured',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            phoneHome.handlePhoneHomeEvent('heartbeat');

            var responseData = '{"state":"discovered","action":"report"}';
            test.mockHTTPS.deferAfterEnd = function(){
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data(responseData);
                responseData = '{"state":"discovered"}';
            };

            phoneHome.eventFinished = function(){
                var configJSON = JSON.stringify(config.settings);
                test.mockLogger.checkMockLogEntries([
                    'phone home: heartbeat',
                    'DEBUG - host input: {"context":{"state":"unregistered","version":"TEST-VERSION","action":"heartbeat","info":{"hostname":"' + os.hostname() + '"}}}',
                    'DEBUG - host output: {"state":"discovered","action":"report"}',
                    'perform host action: report',
                    'DEBUG - host input: {"context":{"state":"discovered","version":"TEST-VERSION","action":"report","info":{"hostname":"' + os.hostname() + '"},"result":' + configJSON + '}}',
                    'DEBUG - host output: {"state":"discovered"}'
                ]);

                test.mockHTTPS.checkWritten([
                    '{"context":{"state":"unregistered","version":"TEST-VERSION","action":"heartbeat","info":{"hostname":"' + os.hostname() + '"}}}',null,
                    '{"context":{"state":"discovered","version":"TEST-VERSION","action":"report","info":{"hostname":"' + os.hostname() + '"},"result":' + configJSON + '}}',null
                ]);
                test.mockHelpers.checkMockFiles([[phoneHome.contextFile,'default']],[[phoneHome.contextFile,{state: 'discovered'}]]);

                (!!phoneHome.checkTimer).should.be.ok;
                phoneHome.clearCheckTimer();
                done();
            };
        });

        it('should apply policies after phoning home if it becomes configured on wakeup',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            config.settings.policies = [];
            test.mockHelpers.filesToRead[phoneHome.contextFile] = {state: 'discovered'};
            test.mockHelpers.filesToRead['s3-ingestor.json'] = {debug: true};

            phoneHome.handlePhoneHomeEvent('wakeup');

            var responseData = '{"state":"configured","config":{"test":123}}';
            test.mockHTTPS.deferAfterEnd = function(){
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data(responseData);
                responseData = '{"state":"configured"}';
            };

            phoneHome.eventFinished = function(){
                test.mockLogger.checkMockLogEntries([
                    'phone home: wakeup',
                    'DEBUG - host input: {"context":{"state":"discovered","version":"TEST-VERSION","action":"wakeup","info":{"hostname":"' + os.hostname() + '"}}}',
                    'DEBUG - host output: {"state":"configured","config":{"test":123}}',
                    'config updated',
                    'DEBUG - {"debug":true,"test":123}',
                    'begin processing policies',
                    'end processing policies',
                    'DEBUG - host input: {"context":{"state":"configured","version":"TEST-VERSION","action":"ack","info":{"hostname":"' + os.hostname() + '"},"result":{"added":0,"updated":0,"skipped":0,"ignored":0,"unchanged":0}}}',
                    'DEBUG - host output: {"state":"configured"}'
                ]);
                test.mockHTTPS.checkWritten([
                    '{"context":{"state":"discovered","version":"TEST-VERSION","action":"wakeup","info":{"hostname":"' + os.hostname() + '"}}}',null,
                    '{"context":{"state":"configured","version":"TEST-VERSION","action":"ack","info":{"hostname":"' + os.hostname() + '"},"result":{"added":0,"updated":0,"skipped":0,"ignored":0,"unchanged":0}}}',null
                ]);
                test.mockHelpers.checkMockFiles(
                    [[phoneHome.contextFile,'success'],['s3-ingestor.json','success'],['s3-ingestor.json','success']],
                    [[phoneHome.contextFile,{state: 'configured'}],['s3-ingestor.json',{debug: true,test: 123}]]
                );

                (!!phoneHome.checkTimer).should.be.ok;
                phoneHome.clearCheckTimer();
                done();
            };
        });

        it('should apply policies after phoning home and it receives a customizers command on wakeup',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            config.settings.policies = [];
            test.mockHelpers.filesToRead[phoneHome.contextFile] = {state: 'configured'};
            test.mockHelpers.filesToRead['s3-ingestor.json'] = {debug: true};

            phoneHome.handlePhoneHomeEvent('wakeup');

            var responseData = '{"state":"configured","action":"customizers"}';
            test.mockHTTPS.deferAfterEnd = function(){
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data(responseData);
                responseData = '{"state":"configured"}';
            };

            test.mockAwsSdk.deferAfterS3ListObjects = function(callback){
                callback(null,{Contents: [{Key: 'test'}]});
            };

            test.mockAwsSdk.deferAfterS3GetObject = function(callback){
                callback(null,{Key: 'test',Body: 'test-body'});
            };

            test.mockHelpers.mkdir = function(path,callback) {
                path.should.eql('./customizers/');
                callback(null)
            };

            test.mockHelpers.writeFile = function(path,data,callback){
                path.should.eql('./customizers/test');
                data.should.eql('test-body');
                callback(null)
            };

            phoneHome.eventFinished = function(){
                test.mockLogger.checkMockLogEntries([
                    'phone home: wakeup',
                    'DEBUG - host input: {"context":{"state":"configured","version":"TEST-VERSION","action":"wakeup","info":{"hostname":"' + os.hostname() + '"}}}',
                    'DEBUG - host output: {"state":"configured","action":"customizers"}',
                    'perform host action: customizers',
                    'DEBUG - customizer count: 1',
                    'DEBUG - customizer: test',
                    'begin processing policies',
                    'end processing policies',
                    'DEBUG - host input: {"context":{"state":"configured","version":"TEST-VERSION","action":"ack+customizers","info":{"hostname":"' + os.hostname() + '"},"result":{"added":0,"updated":0,"skipped":0,"ignored":0,"unchanged":0}}}',
                    'DEBUG - host output: {"state":"configured"}'
                ]);
                test.mockHTTPS.checkWritten([
                    '{"context":{"state":"configured","version":"TEST-VERSION","action":"wakeup","info":{"hostname":"' + os.hostname() + '"}}}',null,
                    '{"context":{"state":"configured","version":"TEST-VERSION","action":"ack+customizers","info":{"hostname":"' + os.hostname() + '"},"result":{"added":0,"updated":0,"skipped":0,"ignored":0,"unchanged":0}}}',null
                ]);
                test.mockHelpers.checkMockFiles(
                    [[phoneHome.contextFile,'success'],[config.settings.aws_keys_file,'default']],
                    [[phoneHome.contextFile,{state: 'configured'}]]
                );
                test.mockAwsSdk.checkMockState([
                    ['s3.listObjects',{Bucket: 'unknown-s3-bucket',Prefix: 'code/s3-ingestor/customizers/'}],
                    ['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}]
                ]);
                delete config.settings.aws_keys;

                (!!phoneHome.checkTimer).should.be.ok;
                phoneHome.clearCheckTimer();
                done();
            };
        });
    });
});