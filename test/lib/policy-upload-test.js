var _ = require('lodash');
var test = require('../test');

var PolicyUpload = require(process.cwd() + '/lib/policy-upload');
var config = require(process.cwd() + '/lib/config');

describe('PolicyUpload',function() {
    var resolveSeen,rejectSeen,result;
    var onResolve   = function(){
        resolveSeen = true;
    };
    var onReject    = function(err){ rejectSeen.push(err); };

    beforeEach(function () {
        var configModule = process.cwd() + '/lib/config';

        test.mockery.enable();
        test.mockery.warnOnReplace(false);
        test.mockery.registerAllowables(['./aws','./config','./logger','lodash',configModule]);
        test.mockery.registerMock('aws-sdk', test.mockAwsSdk);
        test.mockAwsSdk.resetMock();
        test.mockery.registerMock('qiot-glob', test.mockGlob);
        test.mockGlob.resetMock();
        test.mockery.registerMock('./helpers', test.mockHelpers);
        test.mockHelpers.resetMock();
        test.mockery.registerMock('./logger', test.mockLogger);
        test.mockLogger.resetMock();

        config = require(configModule);
        test.mockHelpers.resetMock();

        test.mockLogger.debugging = true;

        resolveSeen     = false;
        rejectSeen      = [];
        result          = {added: 0,updated: 0,skipped: 0,ignored: 0,unchanged: 0};
        test.configGuard.beginGuarding();
    });

    afterEach(function () {
        test.configGuard.finishGuarding();
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
            var context     = {};
            var policy      = new PolicyUpload();
            policy.apply(context,config.copySettings(),onResolve,onReject);
            context.should.eql({action: 'error',error: 'GLOB error: **/*',result: {added: 0,updated: 0,skipped: 0,ignored: 0,unchanged: 0}});

            policy.apply(context,config.copySettings(),onResolve,onReject);
            context.should.eql({action: 'error+error',error: 'GLOB error: **/*',result: {added: 0,updated: 0,skipped: 0,ignored: 0,unchanged: 0}});

            resolveSeen.should.eql(false);
            rejectSeen.should.eql(['GLOB error: **/*','GLOB error: **/*']);

            test.mockLogger.checkMockLogEntries(['ERROR - policy error: GLOB error: **/*','ERROR - policy error: GLOB error: **/*']);
        });

        it('should do nothing when no files found',function(done){
            test.mockGlob.lookup['**/*'] = [];

            var context     = {};
            var policy      = new PolicyUpload();
            policy.apply(context,config.copySettings(),function(){
                context.should.eql({result: {added: 0,updated: 0,skipped: 0,ignored: 0,unchanged: 0}});
                done();
            },onReject);
        });

        it('should trap an error on fs.stat',function(done){
            test.mockGlob.lookup['**/*'] = ['unknown.file'];

            var context     = {};
            var policy      = new PolicyUpload();
            policy.apply(context,config.copySettings(),function(){
                test.mockLogger.checkMockLogEntries(["ERROR - SKIP ERROR: Error: ENOENT: no such file or directory, stat 'unknown.file'"]);
                context.should.eql({result: {added: 0,updated: 0,skipped: 0,ignored: 0,unchanged: 0}});
                done();
            },onReject);
        });

        it('should do nothing on a directory',function(done){
            test.mockGlob.lookup['**/*'] = ['test/'];

            var context     = {};
            var policy      = new PolicyUpload();
            policy.apply(context,config.copySettings(),function(){
                context.should.eql({result: {added: 0,updated: 0,skipped: 0,ignored: 0,unchanged: 0}});
                done();
            },onReject);
        });

        it('should ignore a file with a null "buildKey"',function(done){
            test.mockGlob.lookup['**/*'] = ['test/data/test.json'];

            var context     = {result: result};
            var policy      = new PolicyUpload();

            policy.buildKey = function(){return null;};

            policy.apply(context,config.copySettings(),function(){
                test.mockLogger.checkMockLogEntries(['DEBUG - ... ignore: test/data/test.json']);
                context.should.eql({result: {added: 0,updated: 0,skipped: 0,ignored: 1,unchanged: 0}});

                done();
            },onReject);
        });

        it('should catch an s3.listObjects error',function(done){
            test.mockGlob.lookup['**/*'] = ['test/data/test.json'];

            test.mockAwsSdk.deferAfterS3ListObjects = function(callback){ callback('listObjects-error'); };

            var context     = {result: result};
            var policy      = new PolicyUpload();

            policy.apply(context,config.copySettings(),function(){ true.should.not.be.ok; done(); },function(err){
                err.should.eql('listObjects-error');
                context.should.eql({action: 'error',error: 'listObjects-error',result: {added: 0,updated: 0,skipped: 0,ignored: 0,unchanged: 0}});
                test.mockAwsSdk.checkMockState([['s3.listObjects',{Bucket: 'unknown-s3-bucket',Prefix: 'test/data/test.json'}]]);
                test.mockLogger.checkMockLogEntries(['ERROR - policy error: listObjects-error']);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);

                done();
            });
        });

        it('should catch an s3.upload error',function(done){
            test.mockGlob.lookup['**/*'] = ['test/data/test.json'];

            test.mockAwsSdk.deferAfterS3ListObjects = function(callback){ callback(null,{Contents: []}); };
            test.mockAwsSdk.deferAfterS3Upload = function(callback){ callback('upload-error'); };

            var context     = {result: result};
            var policy      = new PolicyUpload();

            policy.apply(context,config.copySettings(),function(){ true.should.not.be.ok; done(); },function(err){
                err.should.eql('upload-error');
                context.should.eql({action: 'error',error: 'upload-error',result: {added: 1,updated: 0,skipped: 0,ignored: 0,unchanged: 0}});
                test.mockAwsSdk.checkMockState([
                    ['s3.listObjects',{Bucket: 'unknown-s3-bucket',Prefix: 'test/data/test.json'}],
                    ['s3.upload',{Bucket: 'unknown-s3-bucket',Key: 'test/data/test.json',Body: true}]
                ]);
                test.mockLogger.checkMockLogEntries([
                    '... add: test/data/test.json => test/data/test.json',
                    'ERROR - policy error: upload-error'
                ]);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);

                done();
            });
        });

        it('should upload a file and remember it in the "lastSeenList" then "skip" it and finally "update" it',function(done){
            test.mockGlob.lookup['**/*'] = ['test/data/test.json'];

            test.mockAwsSdk.deferAfterS3ListObjects = function(callback){ callback(null,{Contents: []}); };
            test.mockAwsSdk.deferAfterS3Upload = function(callback){ callback(null,true); };

            var context     = {result: result};
            var policy      = new PolicyUpload();

            policy.lastSeenList.should.eql({});

            policy.apply(context,config.copySettings(),function(){
                context.should.eql({result: {added: 1,updated: 0,skipped: 0,ignored: 0,unchanged: 0}});

                var lastSeen = policy.lastSeenList['test/data/test.json'];
                (!!lastSeen).should.be.ok;
                test.mockAwsSdk.checkMockState([
                    ['s3.listObjects',{Bucket: 'unknown-s3-bucket',Prefix: 'test/data/test.json'}],
                    ['s3.upload',{Bucket: 'unknown-s3-bucket',Key: 'test/data/test.json',Body: true}]
                ]);
                test.mockLogger.checkMockLogEntries(['... add: test/data/test.json => test/data/test.json']);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);

                policy.apply(context,config.copySettings(),function(){
                    context.should.eql({result: {added: 1,updated: 0,skipped: 0,ignored: 0,unchanged: 1}});
                    test.mockLogger.checkMockLogEntries(['DEBUG - ... unchanged: test/data/test.json']);

                    test.mockAwsSdk.deferAfterS3ListObjects = function(callback){ callback(null,{Contents: [{Size: lastSeen.size,LastModified: lastSeen.mtime}]}); };
                    lastSeen.mtime = lastSeen.atime;

                    policy.apply(context,config.copySettings(),function(){
                        context.should.eql({result: {added: 1,updated: 0,skipped: 1,ignored: 0,unchanged: 1}});
                        test.mockAwsSdk.checkMockState([['s3.listObjects',{Bucket: 'unknown-s3-bucket',Prefix: 'test/data/test.json'}]]);
                        test.mockLogger.checkMockLogEntries(['DEBUG - ... skip: test/data/test.json => test/data/test.json']);

                        var lastSeen = policy.lastSeenList['test/data/test.json'];
                        lastSeen.mtime = lastSeen.atime;
                        test.mockAwsSdk.deferAfterS3ListObjects = function(callback){ callback(null,{Contents: [{Size: lastSeen.size + 1,LastModified: lastSeen.mtime}]}); };

                        policy.apply(context,config.copySettings(),function(){
                            context.should.eql({result: {added: 1,updated: 1,skipped: 1,ignored: 0,unchanged: 1}});
                            test.mockAwsSdk.checkMockState([
                                ['s3.listObjects',{Bucket: 'unknown-s3-bucket',Prefix: 'test/data/test.json'}],
                                ['s3.upload',{Bucket: 'unknown-s3-bucket',Key: 'test/data/test.json',Body: true}]
                            ]);
                            test.mockLogger.checkMockLogEntries(['... update: test/data/test.json => test/data/test.json']);

                            done();
                        },done);
                    },done);
                },done);
            },done);
        });

        it('should upload a file and delete it',function(done){
            test.mockGlob.lookup['**/*'] = ['test/data/test.json'];

            test.mockAwsSdk.deferAfterS3ListObjects = function(callback){ callback(null,{Contents: []}); };
            test.mockAwsSdk.deferAfterS3Upload = function(callback){ callback(null,true); };

            var deletedFILES = [];
            test.mockHelpers.unlinkSync = function(target) { deletedFILES.push(target); };

            var context     = {result: result};
            var policy      = new PolicyUpload();
            var settings    = config.copySettings();

            settings.delete_after_upload = true;

            policy.lastSeenList.should.eql({});

            policy.apply(context,settings,function(){
                context.should.eql({result: {added: 1,updated: 0,skipped: 0,ignored: 0,unchanged: 0}});

                test.mockAwsSdk.checkMockState([
                    ['s3.listObjects',{Bucket: 'unknown-s3-bucket',Prefix: 'test/data/test.json'}],
                    ['s3.upload',{Bucket: 'unknown-s3-bucket',Key: 'test/data/test.json',Body: true}]
                ]);
                test.mockLogger.checkMockLogEntries(['... add: test/data/test.json => test/data/test.json']);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);
                deletedFILES.should.eql(['test/data/test.json']);
                done();
            },done);
        });

        it('should upload a file and move it',function(done){
            test.mockGlob.lookup['**/*'] = ['test/data/test.json'];

            test.mockAwsSdk.deferAfterS3ListObjects = function(callback){ callback(null,{Contents: []}); };
            test.mockAwsSdk.deferAfterS3Upload = function(callback){ callback(null,true); };

            var renamedFILES = [];
            test.mockHelpers.renameSync = function(src,dst) { renamedFILES.push([src,dst]); };

            var context     = {result: result};
            var policy      = new PolicyUpload();
            var settings    = config.copySettings();

            test.mockHelpers.fileExists = function(filename) { return {isDirectory: function() {return filename == settings.move_after_upload}} };

            settings.input_remove_prefix    = 'test/data/';
            settings.output_key_prefix      = 'upload/';
            settings.move_after_upload      = 'moved/';

            policy.lastSeenList.should.eql({});

            policy.apply(context,settings,function(){
                context.should.eql({result: {added: 1,updated: 0,skipped: 0,ignored: 0,unchanged: 0}});

                test.mockAwsSdk.checkMockState([
                    ['s3.listObjects',{Bucket: 'unknown-s3-bucket',Prefix: 'upload/test.json'}],
                    ['s3.upload',{Bucket: 'unknown-s3-bucket',Key: 'upload/test.json',Body: true}]
                ]);
                test.mockLogger.checkMockLogEntries(['... add: test/data/test.json => upload/test.json']);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);
                renamedFILES.should.eql([['test/data/test.json','moved/test.json']]);
                done();
            },done);
        });

        it('should upload a file and detect invalid move directory',function(done){
            test.mockGlob.lookup['**/*'] = ['test/data/test.json'];

            test.mockAwsSdk.deferAfterS3ListObjects = function(callback){ callback(null,{Contents: []}); };
            test.mockAwsSdk.deferAfterS3Upload = function(callback){ callback(null,true); };

            var context     = {result: result};
            var policy      = new PolicyUpload();
            var settings    = config.copySettings();

            test.mockHelpers.fileExists = function(filename) { return {isDirectory: function() {return false}} };

            settings.input_remove_prefix    = 'test/data/';
            settings.output_key_prefix      = 'upload/';
            settings.move_after_upload      = 'moved/';

            policy.lastSeenList.should.eql({});

            policy.apply(context,settings,function(){
                context.should.eql({result: {added: 1,updated: 0,skipped: 0,ignored: 0,unchanged: 0}});

                test.mockAwsSdk.checkMockState([
                    ['s3.listObjects',{Bucket: 'unknown-s3-bucket',Prefix: 'upload/test.json'}],
                    ['s3.upload',{Bucket: 'unknown-s3-bucket',Key: 'upload/test.json',Body: true}]
                ]);
                test.mockLogger.checkMockLogEntries([
                    '... add: test/data/test.json => upload/test.json',
                    'ERROR - invalid move directory: moved/'
                ]);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);
                done();
            },done);
        });

        it('should upload a file and detect failed rename',function(done){
            test.mockGlob.lookup['**/*'] = ['test/data/test.json'];

            test.mockAwsSdk.deferAfterS3ListObjects = function(callback){ callback(null,{Contents: []}); };
            test.mockAwsSdk.deferAfterS3Upload = function(callback){ callback(null,true); };

            test.mockHelpers.renameSync = function(src,dst) { throw 'test-error'; };

            var context     = {result: result};
            var policy      = new PolicyUpload();
            var settings    = config.copySettings();

            test.mockHelpers.fileExists = function(filename) { return {isDirectory: function() {return filename === settings.move_after_upload}} };

            settings.move_after_upload      = 'moved/';

            policy.lastSeenList.should.eql({});

            policy.apply(context,settings,function(){
                context.should.eql({result: {added: 1,updated: 0,skipped: 0,ignored: 0,unchanged: 0}});

                test.mockAwsSdk.checkMockState([
                    ['s3.listObjects',{Bucket: 'unknown-s3-bucket',Prefix: 'test/data/test.json'}],
                    ['s3.upload',{Bucket: 'unknown-s3-bucket',Key: 'test/data/test.json',Body: true}]
                ]);
                test.mockLogger.checkMockLogEntries([
                    '... add: test/data/test.json => test/data/test.json',
                    'ERROR - rename error: test-error'
                ]);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);
                done();
            },done);
        });
    });
});