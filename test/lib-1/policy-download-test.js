var test = require('../test');

var PolicyDownload = require(process.cwd() + '/lib/policy-download');
var config = require(process.cwd() + '/lib/config');

describe('PolicyDownload',function() {

    beforeEach(function () {
        test.mockery.enable();
        test.mockery.warnOnReplace(false);
        test.mockery.registerAllowables(['./aws']);
        test.mockery.registerMock('aws-sdk', test.mockAwsSdk);
        test.mockAwsSdk.resetMock();
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
        it('should reset the lastTimestamps',function(){
            var policy = new PolicyDownload();
            policy.lastTimestamps.should.eql({});

            policy.lastTimestamps = {something: 'here'};
            policy.reset();
            policy.lastTimestamps.should.eql({});
        })
    });
    
    describe('apply',function(){
        it('should detect glob errors',function(){
            var resolve = false;
            var reject = [];
            var policy = new PolicyDownload();
            policy.apply({},config.settings,function(){ resolve = true; },function(err){
                reject = [err];
            });
            resolve.should.eql(false);
        });
        
        // TODO more here...
    });
});