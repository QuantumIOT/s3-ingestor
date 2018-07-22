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
        var basicHandlerPath = process.cwd() + '/lib/host-basic';
        var qiotHandlerPath = process.cwd() + '/lib/host-qiot-mqtt';
        test.mockery.enable();
        test.mockery.warnOnReplace(false);
        test.mockery.registerAllowables(['lodash','http-status-codes','./aws','./config','./logger','./host-qiot-http',test.configGuard.requirePath,basicHandlerPath,qiotHandlerPath]);
        test.mockery.registerMock('aws-sdk', test.mockAwsSdk);
        test.mockAwsSdk.resetMock();
        test.mockery.registerMock('https', test.mockHTTPS);
        test.mockHTTPS.resetMock();
        test.mockery.registerMock('mqtt',test.mockMQTT);
        test.mockMQTT.resetMock();
        test.mockery.registerMock('./logger', test.mockLogger);
        test.mockLogger.resetMock();
        test.mockery.registerMock('./helpers', test.mockHelpers);
        test.mockHelpers.resetMock();

        config = test.configGuard.beginGuarding();
        test.mockHelpers.resetMock();

        test.mockLogger.debugging = true;
        emitter = new events.EventEmitter();
        oldPolicies = config.settings.policies;
        oldHeartbeatPeriod = config.settings.heartbeat_period;
        config.settings.heartbeat_period = 0.01;

        test.mockHelpers.filesToRequire['policy-test'] = null;
        
        os.hostname = function(){ return 'TESTHOST'; }
    });

    afterEach(function () {
        test.mockLogger.debugging = false;
        config.settings.policies = oldPolicies;
        config.settings.heartbeat_period = oldHeartbeatPeriod;
        test.configGuard.finishGuarding();
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

    describe('performHostAction',function(){
        it('should handle upgrade commands',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            var success = false;
            phoneHome.upgradeSelf = function(context,resolve,reject){
                success = true;
                resolve();
            };

            phoneHome.performHostAction('upgrade',{test: true}).then(function(){
                success.should.be.ok;
                test.mockLogger.checkMockLogEntries(['perform host action: upgrade']);

                done();
            },function(){ true.should.not.be.ok; done(); });
        });

        it('should handle reboot commands',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            var success = false;
            phoneHome.rebootSystem = function(context,resolve,reject){
                success = true;
                resolve();
            };

            phoneHome.performHostAction('reboot',{test: true}).then(function(){
                success.should.be.ok;
                test.mockLogger.checkMockLogEntries(['perform host action: reboot']);

                done();
            },function(){ true.should.not.be.ok; done(); });
        });

        it('should handle restart commands',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            test.mockHelpers.processExit = function(){
                test.mockLogger.checkMockLogEntries(['perform host action: restart']);

                done();
            };

            var shouldNotHappen = function(){ true.should.not.be.ok; done(); };
            phoneHome.performHostAction('restart',{test: true}).then(shouldNotHappen,shouldNotHappen);
        });
    });

    describe('downloadCustomizers',function() {
        it('should handle an error on s3.listObjects', function (done) {
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            var context = {state: 'test',action: 'test'};

            test.mockAwsSdk.deferAfterS3ListObjects = function(callback){ callback('listObjects-error'); };

            test.mockHTTPS.deferAfterEnd = function(){
                test.asyncMidpoint(done,function(){
                    (!!test.mockHTTPS.events.data).should.be.ok;
                    test.mockHTTPS.events.data(JSON.stringify({state: 'test'}));
                })
            };

            function checkResults(){
                test.asyncDone(done,function(){
                    test.mockLogger.checkMockLogEntries([
                        'ERROR - download customizers error - listObjects-error',
                        'DEBUG - host POST: {"context":{"state":"test","action":"test+error","error":"listObjects-error"}}',
                        'DEBUG - host output: {"state":"test"}'
                    ]);
                    test.mockHTTPS.checkWritten(['{"context":{"state":"test","action":"test+error","error":"listObjects-error"}}',null]);
                    test.mockHelpers.checkMockFiles([[ config.home_full_path + '/s3-ingestor-keys.json','default']]);
                    test.mockAwsSdk.checkMockState([['s3.listObjects',{Bucket: 'unknown-s3-bucket',Prefix: 'code/s3-ingestor/customizers/'}]]);
                });
            }

            phoneHome.downloadCustomizers(context,checkResults,done);
        });

        it('should handle an error on s3.getObject', function (done) {
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            var context = {state: 'test'};
            config.settings.policies = [];

            test.mockAwsSdk.deferAfterS3ListObjects = function(callback){ callback(null,{Contents: [{Key: 'test'}]}); };
            test.mockAwsSdk.deferAfterS3GetObject   = function(callback){ callback('download-error'); };

            test.mockHTTPS.deferAfterEnd = function(){
                test.asyncMidpoint(done,function(){
                    (!!test.mockHTTPS.events.data).should.be.ok;
                    test.mockHTTPS.events.data(JSON.stringify({state: 'test'}));
                })
            };

            function checkResults(){
                test.asyncDone(done,function(){
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - customizer count: 1',
                        'DEBUG - customizer: test',
                        'ERROR - download customizers error - download-error',
                        'DEBUG - host POST: {"context":{"state":"test","action":"error","error":"download-error"}}',
                        'DEBUG - host output: {"state":"test"}'
                    ]);
                    test.mockHTTPS.checkWritten(['{"context":{"state":"test","action":"error","error":"download-error"}}',null]);
                    test.mockHelpers.checkMockFiles([[config.home_full_path + '/s3-ingestor-keys.json','default']]);
                    test.mockAwsSdk.checkMockState([
                        ['s3.listObjects',{Bucket: 'unknown-s3-bucket',Prefix: 'code/s3-ingestor/customizers/'}],
                        ['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}]
                    ]);
                });
            }

            phoneHome.downloadCustomizers(context,checkResults,done);
        });

        it('should handle an error on writeFile', function (done) {
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            var context = {state: 'test'};
            config.settings.policies = [];

            test.mockAwsSdk.deferAfterS3ListObjects = function(callback){ callback(null,{Contents: [{Key: 'test'}]}); };
            test.mockAwsSdk.deferAfterS3GetObject   = function(callback){ callback(null,{Key: 'test',Body: 'test-body'}); };

            test.mockHelpers.mkdir = function(path,callback) {
                path.should.eql(config.home_full_path + '/customizers/');
                callback(null)
            };

            test.mockHelpers.writeFile = function(path,data,callback){
                path.should.eql(config.home_full_path + '/customizers/test');
                data.should.eql('test-body');
                callback('writeFile-error')
            };

            test.mockHTTPS.deferAfterEnd = function(){
                test.asyncMidpoint(done,function(){
                    (!!test.mockHTTPS.events.data).should.be.ok;
                    test.mockHTTPS.events.data(JSON.stringify({state: 'test'}));
                })
            };

            function checkResults(){
                test.asyncDone(done,function(){
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - customizer count: 1',
                        'DEBUG - customizer: test',
                        'ERROR - download customizers error - writeFile-error',
                        'DEBUG - host POST: {"context":{"state":"test","action":"error","error":"writeFile-error"}}',
                        'DEBUG - host output: {"state":"test"}'
                    ]);
                    test.mockHTTPS.checkWritten(['{"context":{"state":"test","action":"error","error":"writeFile-error"}}',null]);
                    test.mockHelpers.checkMockFiles([[config.home_full_path + '/s3-ingestor-keys.json','default']]);
                    test.mockAwsSdk.checkMockState([
                        ['s3.listObjects',{Bucket: 'unknown-s3-bucket',Prefix: 'code/s3-ingestor/customizers/'}],
                        ['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}]
                    ]);
                });
            }

            phoneHome.downloadCustomizers(context,checkResults,done);
        });
    });

    describe('upgradeSelf',function(){
        it('should perform a processExit on success',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            test.mockHTTPS.deferAfterEnd = function() {
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data('{"state":"test"}');
            };

            test.mockHelpers.processExec = function(command,callback){
                command.should.eql('npm install s3-ingestor');
                callback(null);
            };

            test.mockHelpers.processExit = function(){
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - host POST: {"context":{"state":"test"}}',
                    'DEBUG - host output: {"state":"test"}'
                ]);

                done();
            };

            var shouldNotHappen = function(){ true.should.not.be.ok; done(); };
            phoneHome.upgradeSelf({state: 'test'},shouldNotHappen,shouldNotHappen);
        });

        it('should report an error on failure',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            test.mockHTTPS.deferAfterEnd = function() {
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data('{"state":"test"}');
            };

            test.mockHelpers.processExec = function(command,callback){
                command.should.eql('npm install s3-ingestor');
                callback('process-error');
            };

            phoneHome.upgradeSelf({state: 'test'},function(){
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - host POST: {"context":{"state":"test","action":"upgrade+error","error":"process-error"}}',
                    'DEBUG - host output: {"state":"test"}'
                ]);

                done();
            },done);
        });
    });

    describe('rebootSystem',function(){
        it('should execute reboot action on success',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            test.mockHTTPS.deferAfterEnd = function() {
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data('{"state":"test"}');
            };

            test.mockHelpers.processExec = function(command,callback){
                command.should.eql('echo reboot');
                callback(null);
            };

            phoneHome.rebootSystem({state: 'test'},function(){
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - host POST: {"context":{"state":"test"}}',
                    'DEBUG - host output: {"state":"test"}'
                ]);

                done();
            },done);
        });

        it('should report an error on failure',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            test.mockHTTPS.deferAfterEnd = function() {
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data('{"state":"test"}');
            };

            test.mockHelpers.processExec = function(command,callback){
                command.should.eql('echo reboot');
                callback('process-error');
            };

            phoneHome.rebootSystem({state: 'test'},function(){
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - host POST: {"context":{"state":"test","action":"reboot+error","error":"process-error"}}',
                    'DEBUG - host output: {"state":"test"}'
                ]);

                done();
            },done);
        });
    });

    describe('registration',function(){
        beforeEach(function(){
            config.settings.qiot_account_token  = 'ACCOUNT-TOKEN';
            config.settings.hostname_override   = 'OVERRIDEHOST';
        });

        afterEach(function(){
            delete config.settings.qiot_account_token;
            delete config.settings.hostname_override;
        });

        it('should do nothing on startup if registration is required and not received',function(done){

            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            phoneHome.handlePhoneHomeEvent('register');

            test.mockHTTPS.deferAfterEnd = function() {
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data('{}');
                (!!test.mockHTTPS.events.end).should.be.ok;
                test.mockHTTPS.events.end();
            };

            phoneHome.eventFinished = function(){
                test.asyncMidpoint(done,function(){
                    test.mockHTTPS.checkWritten(['{"identity":[{"type":"HOSTNAME","value":"OVERRIDEHOST"}],"label":"HOSTNAME-OVERRIDEHOST"}',null]);
                    test.mockLogger.checkMockLogEntries([
                        'phone home: register',
                        'DEBUG - host POST /1/r: {"identity":[{"type":"HOSTNAME","value":"OVERRIDEHOST"}],"label":"HOSTNAME-OVERRIDEHOST"}',
                        'DEBUG - host output: {}',
                        'DEBUG - host status: OK',
                        'ERROR - phone home error - no registration received'
                    ]);
                    test.mockHelpers.checkMockFiles([[phoneHome.contextFile,'default']]);

                    (!!phoneHome.checkTimer).should.be.ok;
                });

                emitter.on('phonehome',function(action){
                    test.asyncDone(done,function(){
                        phoneHome.clearCheckTimer();
                        action.should.eql('heartbeat');
                    });
                });

            };
        });

        it('should trigger a normal startup after registration is received',function(done){

            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            emitter.on('phonehome',function(action){
                test.asyncDone(done,function(){
                    phoneHome.clearCheckTimer();

                    test.mockLogger.checkMockLogEntries([
                        'phone home: register',
                        'DEBUG - host POST /1/r: {"identity":[{"type":"HOSTNAME","value":"OVERRIDEHOST"}],"label":"HOSTNAME-OVERRIDEHOST"}',
                        'DEBUG - host output: {"thing":{"account_token":"ACCOUNT-TOKEN","collection_token":"COLLECTION-TOKEN","thing_token":"THING-TOKEN"}}',
                        'DEBUG - host status: OK',
                        'DEBUG - registration received'
                    ]);
                    test.mockHTTPS.checkWritten(['{"identity":[{"type":"HOSTNAME","value":"OVERRIDEHOST"}],"label":"HOSTNAME-OVERRIDEHOST"}',null]);
                    test.mockHelpers.checkMockFiles(
                        [[phoneHome.contextFile,'default']],
                        [[phoneHome.contextFile,{state: 'registered',qiot_collection_token: 'COLLECTION-TOKEN',qiot_thing_token: 'THING-TOKEN'}]]
                    );

                    action.should.eql('startup');
                });
            });

            test.mockHTTPS.deferAfterEnd = function() {
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data(JSON.stringify({thing: {account_token: 'ACCOUNT-TOKEN',collection_token: 'COLLECTION-TOKEN',thing_token: 'THING-TOKEN'}}));
                (!!test.mockHTTPS.events.end).should.be.ok;
                test.mockHTTPS.events.end();
            };

            phoneHome.handlePhoneHomeEvent('register');
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
                    'DEBUG - host POST: {"context":{"state":"unregistered","version":"TEST-VERSION","action":"startup","info":' + infoString + '}}',
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
                    'DEBUG - host POST: {"context":{"state":"unregistered","version":"TEST-VERSION","action":"heartbeat","info":' + infoString + '}}',
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

        it('should do catch an error if it receives no data',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            phoneHome.handlePhoneHomeEvent('startup');

            test.mockHTTPS.deferAfterEnd = function() {
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data(null);
            };

            phoneHome.eventFinished = function(){
                var infoString = JSON.stringify(phoneHome.readLocalInfo(true));
                test.mockLogger.checkMockLogEntries([
                    'phone home: startup',
                    'DEBUG - host POST: {"context":{"state":"unregistered","version":"TEST-VERSION","action":"startup","info":' + infoString + '}}',
                    "ERROR - phone home error - TypeError: Cannot read property 'toString' of null"
                ]);
                test.mockHTTPS.checkWritten(['{"context":{"state":"unregistered","version":"TEST-VERSION","action":"startup","info":' + infoString + '}}',null]);
                test.mockHelpers.checkMockFiles([[phoneHome.contextFile,'default']]);

                (!!phoneHome.checkTimer).should.be.ok;
                phoneHome.clearCheckTimer();
                done();
            };
        });

        it('should do catch an error if it receives malformed json',function(done){
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
                    'DEBUG - host POST: {"context":{"state":"unregistered","version":"TEST-VERSION","action":"startup","info":' + infoString + '}}',
                    'DEBUG - host output: {',
                    'ERROR - json error: SyntaxError: Unexpected end of input',
                    'ERROR - phone home error - no json received'
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
                test.asyncDone(done,function(){
                    test.mockLogger.checkMockLogEntries([
                        'phone home: heartbeat',
                        'begin processing policies',
                        'ERROR - handler not found: test',
                        'no-op apply: test',
                        'end processing policies',
                        'DEBUG - host POST: {"context":{"state":"configured","version":"TEST-VERSION","action":"heartbeat","info":{"hostname":"TESTHOST"}}}',
                        'DEBUG - host output: {"state":"configured"}'
                    ]);

                    test.mockHTTPS.checkWritten(['{"context":{"state":"configured","version":"TEST-VERSION","action":"heartbeat","info":{"hostname":"TESTHOST"}}}',null]);
                    test.mockHelpers.checkMockFiles([[phoneHome.contextFile,'success']],[[phoneHome.contextFile,{state: 'configured'}]]);

                    (!!phoneHome.checkTimer).should.be.ok;
                    phoneHome.clearCheckTimer();
                });
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
                    'DEBUG - host POST: {"context":{"state":"unregistered","version":"TEST-VERSION","action":"heartbeat","info":{"hostname":"TESTHOST"}}}',
                    'DEBUG - host output: {"state":"discovered","action":"report"}',
                    'perform host action: report',
                    'DEBUG - host POST: {"context":{"state":"discovered","version":"TEST-VERSION","action":"report","info":{"hostname":"TESTHOST"},"result":' + configJSON + '}}',
                    'DEBUG - host output: {"state":"discovered"}'
                ]);

                test.mockHTTPS.checkWritten([
                    '{"context":{"state":"unregistered","version":"TEST-VERSION","action":"heartbeat","info":{"hostname":"TESTHOST"}}}',null,
                    '{"context":{"state":"discovered","version":"TEST-VERSION","action":"report","info":{"hostname":"TESTHOST"},"result":' + configJSON + '}}',null
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
            test.mockHelpers.filesToRead[config.config_file] = {debug: true};

            phoneHome.handlePhoneHomeEvent('wakeup');

            var responseData = '{"state":"configured","config":{"test":123}}';
            test.mockHTTPS.deferAfterEnd = function(){
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data(responseData);
                responseData = '{"state":"configured"}';
            };

            phoneHome.eventFinished = function(){
                test.asyncDone(done,function(){
                    test.mockLogger.checkMockLogEntries([
                        'phone home: wakeup',
                        'DEBUG - host POST: {"context":{"state":"discovered","version":"TEST-VERSION","action":"wakeup","info":{"hostname":"TESTHOST"}}}',
                        'DEBUG - host output: {"state":"configured","config":{"test":123}}',
                        'config updated',
                        'DEBUG - {"debug":true,"test":123}',
                        'begin processing policies',
                        'end processing policies',
                        'DEBUG - host POST: {"context":{"state":"configured","version":"TEST-VERSION","action":"ack","info":{"hostname":"TESTHOST"}}}',
                        'DEBUG - host output: {"state":"configured"}'
                    ]);
                    test.mockHTTPS.checkWritten([
                        '{"context":{"state":"discovered","version":"TEST-VERSION","action":"wakeup","info":{"hostname":"TESTHOST"}}}',null,
                        '{"context":{"state":"configured","version":"TEST-VERSION","action":"ack","info":{"hostname":"TESTHOST"}}}',null
                    ]);
                    test.mockHelpers.checkMockFiles(
                        [[phoneHome.contextFile,'success'],[config.config_file,'success'],[config.config_file,'success']],
                        [[phoneHome.contextFile,{state: 'configured'}],[config.config_file,{debug: true,test: 123}]]
                    );

                    (!!phoneHome.checkTimer).should.be.ok;
                    phoneHome.clearCheckTimer();
                    config.settings.debug = false;
                    delete config.settings.test;
                });
            };
        });

        it('should apply policies after phoning home and it receives a customizers command on wakeup',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            config.settings.policies = [];
            test.mockHelpers.filesToRead[phoneHome.contextFile] = {state: 'configured'};
            test.mockHelpers.filesToRead[config.config_file] = {debug: true};

            phoneHome.handlePhoneHomeEvent('wakeup');

            var responseData = '{"state":"configured","action":"customizers"}';
            test.mockHTTPS.deferAfterEnd = function(){
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data(responseData);
                responseData = '{"state":"configured"}';
            };

            test.mockAwsSdk.deferAfterS3ListObjects = function(callback){ callback(null,{Contents: [{Key: 'test'}]}); };
            test.mockAwsSdk.deferAfterS3GetObject   = function(callback){ callback(null,{Key: 'test',Body: 'test-body'}); };

            test.mockHelpers.mkdir = function(path,callback) {
                path.should.eql(config.home_full_path + '/customizers/');
                callback(null)
            };

            test.mockHelpers.writeFile = function(path,data,callback){
                path.should.eql(config.home_full_path + '/customizers/test');
                data.should.eql('test-body');
                callback(null)
            };

            phoneHome.eventFinished = function(){
                test.asyncDone(done,function(){
                    test.mockLogger.checkMockLogEntries([
                        'phone home: wakeup',
                        'DEBUG - host POST: {"context":{"state":"configured","version":"TEST-VERSION","action":"wakeup","info":{"hostname":"TESTHOST"}}}',
                        'DEBUG - host output: {"state":"configured","action":"customizers"}',
                        'perform host action: customizers',
                        'DEBUG - customizer count: 1',
                        'DEBUG - customizer: test',
                        'begin processing policies',
                        'end processing policies',
                        'DEBUG - host POST: {"context":{"state":"configured","version":"TEST-VERSION","action":"ack+customizers","info":{"hostname":"TESTHOST"}}}',
                        'DEBUG - host output: {"state":"configured"}'
                    ]);
                    test.mockHTTPS.checkWritten([
                        '{"context":{"state":"configured","version":"TEST-VERSION","action":"wakeup","info":{"hostname":"TESTHOST"}}}',null,
                        '{"context":{"state":"configured","version":"TEST-VERSION","action":"ack+customizers","info":{"hostname":"TESTHOST"}}}',null
                    ]);
                    test.mockHelpers.checkMockFiles(
                        [[phoneHome.contextFile,'success'],[config.settings.aws_keys_file,'default']],
                        [[phoneHome.contextFile,{state: 'configured'}]]
                    );
                    test.mockAwsSdk.checkMockState([
                        ['s3.listObjects',{Bucket: 'unknown-s3-bucket',Prefix: 'code/s3-ingestor/customizers/'}],
                        ['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}]
                    ]);

                    (!!phoneHome.checkTimer).should.be.ok;
                    phoneHome.clearCheckTimer();
                });
            };
        });
    });
});