var test = require('../test');

var PolicyBase = require(process.cwd() + '/lib/policy-base');
var config = require(process.cwd() + '/lib/config');
var policySettings = undefined;

describe('PolicyBase',function() {

    beforeEach(function () {
        test.mockery.enable();
        test.mockery.warnOnReplace(false);
        test.mockery.registerMock('./helpers', test.mockHelpers);
        test.mockery.registerAllowables([process.cwd() + '/test/customizers/test',test.configGuard.requirePath]);
        test.mockHelpers.resetMock();
        test.mockery.registerMock('./logger', test.mockLogger);
        test.mockLogger.resetMock();
        test.configGuard.beginGuarding();

        policySettings = {customizers_path: process.cwd() + '/test/customizers/'};
    });

    afterEach(function () {
        test.configGuard.finishGuarding();
        test.mockLogger.checkMockLogEntries();
        test.mockHelpers.checkMockFiles();
        test.mockery.deregisterAll();
        test.mockery.disable();
    });
    
    describe('setupBase',function(){
        it('should add "helpers" to the object',function(){
            var policy = new PolicyBase();

            (!!policy.helpers).should.not.be.ok;

            policy.setupBase();

            policy.helpers.should.eql(test.mockHelpers);
        })
    });
    
    describe('ensureCustomizer',function(){
        it('should return falsy if no settings.customizer',function(){
            var policy = new PolicyBase();

            policy.setupBase();

            policy.ensureCustomizer(policySettings).should.not.be.ok;
        });

        it('should return falsy if settings.customizer not found',function(){
            var policy = new PolicyBase();

            policy.setupBase();

            policySettings.customizer = 'unknown';

            policy.ensureCustomizer(policySettings).should.not.be.ok;
        });

        it('should return falsy if settings.customizer not found',function(){
            var policy = new PolicyBase();

            policy.setupBase();

            test.mockHelpers.processCWD = function(){ return process.cwd() + '/test'; };

            policySettings.customizer = 'test';

            policy.ensureCustomizer(policySettings).should.be.ok;
        });
    });

    describe('buildKey',function(){
        it('should return the given key when there is no settings.customizer',function(){
            var policy = new PolicyBase();

            policy.setupBase();

            policy.buildKey({},'test').should.eql('test');
        });

        it('should return null if settings.customizer does not load a function',function(){
            var policy = new PolicyBase();

            policy.setupBase();

            policySettings.customizer = 'unknown';

            (!!policy.buildKey(policySettings,'test')).should.not.be.ok;
        });

        it('should return the result of a customizer if settings.customizer exists',function(){
            var policy = new PolicyBase();

            policy.setupBase();

            test.mockHelpers.processCWD = function(){ return process.cwd() + '/test'; };

            policySettings.customizer = 'test';
            policySettings.testKEY    = 'test-key';

            policy.buildKey(policySettings,'test').should.eql('test-key');
        });
    });
});