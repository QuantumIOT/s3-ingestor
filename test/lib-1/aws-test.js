var test = require('../test');

var AWS = require(process.cwd() + '/lib/aws');
var config = require(process.cwd() + '/lib/config');

describe('AWS',function(){

    beforeEach(function () {
        test.mockery.enable();
        test.mockery.warnOnReplace(false);
        test.mockery.registerAllowables([test.configGuard.requirePath]);
        test.mockery.registerMock('aws-sdk',test.mockAwsSdk);
        test.mockAwsSdk.resetMock();
        test.mockery.registerMock('./helpers',test.mockHelpers);
        test.mockHelpers.resetMock();
        test.mockery.registerMock('./logger',test.mockLogger);
        test.mockLogger.resetMock();
        test.configGuard.beginGuarding();
    });

    afterEach(function () {
        test.configGuard.finishGuarding();
        test.mockAwsSdk.checkMockState();
        test.mockHelpers.checkMockFiles();
        test.mockLogger.checkMockLogEntries();
        test.mockery.disable();
    });

    describe('optionallyResetS3',function(){
        it('should immediately call the callback when no aws_keys are given',function(){
            var called = false;
            var aws = new AWS(config.copySettings());
            aws.optionallyResetS3(undefined,function(){
                called = true;
            });
            called.should.eql(true);
        });
        
        it('should save keys wait for them to become valid if keys are given',function(done){
            var called = false;
            var settings = config.copySettings();
            settings.iam_reset_period = 0.01;

            var aws = new AWS(settings);
            aws.optionallyResetS3({success: true},function(){ called = true; });

            called.should.eql(false);
            test.mockHelpers.checkMockFiles([],[[settings.aws_keys_file,{success: true}]]);
            test.mockLogger.checkMockLogEntries(['waiting for IAM keys to become valid...']);
            aws.settings.aws_keys.should.eql({success: true});

            setTimeout(function(){
                called.should.eql(true);
                done();
            },settings.iam_reset_period * 1000 + 1);
        })
    });

    describe('configureS3',function(){
        it('should read aws keys the first time only',function(){
            var settings = config.copySettings();

            var aws = new AWS(settings);

            test.should.not.exist(aws.s3);

            test.mockHelpers.filesToRead[config.settings.aws_keys_file] = {success: true};

            aws.configureS3().should.eql(aws.s3);

            test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'success']]);

            aws = new AWS(settings);

            test.should.not.exist(aws.s3);

            aws.configureS3().should.eql(aws.s3);

            test.mockHelpers.checkMockFiles();
        })
    });

});