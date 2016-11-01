var _ = require('lodash');
var test = require('../test');

var PolicySocket = require(process.cwd() + '/lib/policy-socket');
var config = require(process.cwd() + '/lib/config');

describe('PolicySocket',function() {

    beforeEach(function () {
        test.mockery.enable();
        test.mockery.warnOnReplace(false);
        test.mockery.registerAllowables(['./aws',test.configGuard.requirePath]);
        test.mockery.registerMock('aws-sdk', test.mockAwsSdk);
        test.mockAwsSdk.resetMock();
        test.mockery.registerMock('net',test.mockNET);
        test.mockNET.resetMock();
        test.mockery.registerMock('then-redis',test.mockRedis);
        test.mockRedis.resetMock();
        test.mockery.registerMock('./helpers', test.mockHelpers);
        test.mockHelpers.resetMock();
        test.mockery.registerMock('./logger', test.mockLogger);
        test.mockLogger.resetMock();
        test.mockLogger.debugging = true;
        test.configGuard.beginGuarding();
    });

    afterEach(function () {
        test.configGuard.finishGuarding();
        test.mockRedis.snapshot().should.eql([]);
        test.mockNET.checkSockets();
        test.mockAwsSdk.checkMockState();
        test.mockHelpers.checkMockFiles();
        test.mockLogger.checkMockLogEntries();
        test.mockery.deregisterAll();
        test.mockery.disable();
    });
    
    describe('reset',function(){
        it('should do nothing if S3 has not been setup',function(){
            var policy = new PolicySocket();

            (!policy.s3).should.be.ok;
            policy.reset();
        });

        it('should reset S3 if it has been setup',function(){
            var policy = new PolicySocket();

            policy.s3 = 'test';
            policy.reset();
            (!policy.s3).should.be.ok;
            test.mockLogger.checkMockLogEntries(['DEBUG - upload stopped']);
        });
    });
    
    describe('apply',function(){
        it('start the socket and uploads',function(done){
            var resolve = false;
            var reject = [];
            var policy = new PolicySocket();
            policy.apply({},config.copySettings(),function(){ resolve = true; },function(err){
                reject = [err];
            });
            resolve.should.eql(true);
            reject.should.eql([]);
            test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);
            test.mockNET.checkSockets([[
                'on:data',
                'on:close',
                'on:error',
                'setTimeout:15000',
                'connect:undefined:undefined'
            ]]);
            policy.reset();
            _.defer(function(){
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - upload started',
                    'DEBUG - upload stopped',
                    'DEBUG - queue checking stopped'
                ]);
                done();
            });
        });

        // TODO more here...
    });
});