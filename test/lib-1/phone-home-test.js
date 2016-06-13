var _ = require('lodash');
var test = require('../test');

var os = require('os');
var events = require('events');

var PhoneHome = require(process.cwd() + '/lib/phone-home');
var config = require(process.cwd() + '/lib/config');

describe('PhoneHome',function() {

    var emitter = null;
    var oldPolicies = null;

    beforeEach(function () {
        test.mockery.enable();
        test.mockery.warnOnReplace(false);
        test.mockery.registerAllowables(['./aws','./config']);
        test.mockery.registerMock('aws-sdk', test.mockAwsSdk);
        test.mockAwsSdk.resetMock();
        test.mockery.registerMock('https', test.mockHTTPS);
        test.mockHTTPS.resetMock();
        test.mockery.registerMock('./helpers', test.mockHelpers);
        test.mockHelpers.resetMock();
        test.mockery.registerMock('./logger', test.mockLogger);
        test.mockLogger.resetMock();

        test.mockLogger.debugging = true;
        emitter = new events.EventEmitter();
        oldPolicies = config.settings.policies;
    });

    afterEach(function () {
        test.mockLogger.debugging = false;
        config.settings.policies = oldPolicies;
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
    
    describe('performAction',function(){
        it('should do nothing unless context state is configured',function(done){
            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            phoneHome.performAction('test');
            test.mockHelpers.checkMockFiles([[phoneHome.contextFile,'default']]);
            _.defer(function(){

                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data('{"state":"test"}');

                _.defer(function(){
                    test.mockLogger.checkMockLogEntries([
                        'phone home: test',
                        'DEBUG - host input: {"context":{"state":"unregistered","version":"TEST-VERSION","action":"test","info":{"hostname":"' + os.hostname() + '"}}}',
                        'DEBUG - host output: {"state":"test"}'
                    ]);
                    test.mockHTTPS.written.should.eql(['{"context":{"state":"unregistered","version":"TEST-VERSION","action":"test","info":{"hostname":"' + os.hostname() + '"}}}',null]);
                    test.mockHelpers.checkMockFiles([],[[phoneHome.contextFile,{state: 'test'}]]);

                    (!!phoneHome.checkTimer).should.be.ok;
                    phoneHome.clearCheckTimer();
                    done();
                });
            });
        });

        it('should apply policies when configured',function(done){
            config.settings.policies = [{handler: 'test'}];

            var phoneHome = new PhoneHome(emitter,'TEST-VERSION');

            test.mockHelpers.filesToRead[phoneHome.contextFile] = {state: 'configured'};

            phoneHome.performAction('test');
            test.mockHelpers.checkMockFiles([[phoneHome.contextFile,'success']]);
            test.mockLogger.checkMockLogEntries([
                'phone home: test',
                'begin processing policies',
            ]);
            setTimeout(function(){
                test.mockLogger.checkMockLogEntries([
                    'ERROR - handler not found: test',
                    'no-op apply: test',
                    'end processing policies',
                    'DEBUG - host input: {"context":{"state":"configured","version":"TEST-VERSION","action":"test","info":{"hostname":"new-host-2.home"},"result":{"added":0,"updated":0,"skipped":0,"ignored":0,"unchanged":0}}}'
                ]);

                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data('{"state":"test"}');

                _.defer(function(){
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host output: {"state":"test"}'
                    ]);
                    test.mockHTTPS.written.should.eql(['{"context":{"state":"configured","version":"TEST-VERSION","action":"test","info":{"hostname":"' + os.hostname() + '"},"result":{"added":0,"updated":0,"skipped":0,"ignored":0,"unchanged":0}}}',null]);
                    test.mockHelpers.checkMockFiles([],[[phoneHome.contextFile,{state: 'test'}]]);

                    (!!phoneHome.checkTimer).should.be.ok;
                    phoneHome.clearCheckTimer();
                    done();
                });
            },10);
        });
    });
});