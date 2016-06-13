var test = require('../test');

var PolicyUpload = require(process.cwd() + '/lib/policy-upload');
var config = require(process.cwd() + '/lib/config');

describe('PolicyUpload',function() {

    beforeEach(function () {
        test.mockery.enable();
        test.mockery.warnOnReplace(false);
        test.mockery.registerAllowables(['./aws']);
        test.mockery.registerMock('aws-sdk', test.mockAwsSdk);
        test.mockAwsSdk.resetMock();
        test.mockery.registerMock('glob', test.mockGlob);
        test.mockGlob.resetMock();
        test.mockery.registerMock('./helpers', test.mockHelpers);
        test.mockHelpers.resetMock();
        test.mockery.registerMock('./logger', test.mockLogger);
        test.mockLogger.resetMock();
    });

    afterEach(function () {
        test.mockAwsSdk.checkMockState();
        test.mockHelpers.checkMockFiles();
        test.mockLogger.checkMockLogEntries();
        test.mockery.deregisterAll();
        test.mockery.disable();
    });
    
    describe('reset',function(){
        it('should reset the lastSeenList',function(){
            var policy = new PolicyUpload();
            policy.lastSeenList.should.eql({});

            policy.lastSeenList = {something: 'here'};
            policy.reset();
            policy.lastSeenList.should.eql({});
        })
    });
    
    describe('apply',function(){
        it('should detect glob errors',function(){
            var resolve = false;
            var reject = [];
            var policy = new PolicyUpload();
            policy.apply({},config.settings,function(){ resolve = true; },function(err){
                reject = [err];
            });
            resolve.should.eql(false);
            reject.should.eql(['GLOB error: **/*'])
        });
        
        // TODO more here...
    });
});