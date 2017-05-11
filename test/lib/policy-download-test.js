var test = require('../test');

var PolicyDownload = require(process.cwd() + '/lib/policy-download');
var config = require(process.cwd() + '/lib/config');

describe('PolicyDownload',function() {

    var downloadsDIR,downloadsFILES,deletedFILES,renamedFILES;

    beforeEach(function () {
        test.mockery.enable();
        test.mockery.warnOnReplace(false);
        test.mockery.registerAllowables(['./aws','./logger',test.configGuard.requirePath]);
        test.mockery.registerMock('aws-sdk', test.mockAwsSdk);
        test.mockAwsSdk.resetMock();
        test.mockery.registerMock('./helpers', test.mockHelpers);
        test.mockHelpers.resetMock();
        test.mockery.registerMock('./logger', test.mockLogger);
        test.mockLogger.resetMock();

        test.mockLogger.debugging = true;

        downloadsDIR = '';
        test.mockHelpers.mkdirSync = function(target) { downloadsDIR = target; };

        downloadsFILES = [];
        test.mockHelpers.readdirSync = function(target) { return downloadsFILES; };

        deletedFILES = [];
        test.mockHelpers.unlinkSync = function(target) { deletedFILES.push(target); };
        
        renamedFILES = [];
        test.mockHelpers.renameSync = function(src,dst) { renamedFILES.push([src,dst]); };
        
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
        it('should reset the lastTimestamps',function(){
            var policy = new PolicyDownload();
            policy.lastTimestamps.should.eql({});

            policy.lastTimestamps = {something: 'here'};
            policy.reset();
            policy.lastTimestamps.should.eql({});
        })
    });

    describe('apply',function(){
        it('should do nothing with no keys or files',function(done){
            var policy = new PolicyDownload();

            policy.apply({},config.copySettings({target_directory: 'test'}),function(){
                done();
            },done);
        });

        it('should delete all files with no file keys',function(done){
            var policy = new PolicyDownload();

            downloadsFILES = ['test'];
            policy.apply({},config.copySettings(),function(){
                downloadsDIR.should.eql('downloads');
                deletedFILES.should.eql(['downloads/test']);
                renamedFILES.should.eql([]);
                test.mockLogger.checkMockLogEntries(['DEBUG - delete: test']);
                done();
            },done);
        });

        it('should record an s3.headObject error',function(done){
            var policy = new PolicyDownload();
            var settings = config.copySettings();
            settings.file_keys = ['test'];

            test.mockAwsSdk.deferAfterS3HeadObject = function(callback){ callback('headObject-error'); };

            policy.apply({},settings,function(){
                downloadsDIR.should.eql('downloads');
                deletedFILES.should.eql([]);
                renamedFILES.should.eql([]);
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - consider: test',
                    'ERROR - download error: headObject-error test'
                ]);
                test.mockAwsSdk.checkMockState([['s3.headObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}]]);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);

                done();
            },done);
        });

        it('should record an s3.getObject error',function(done){
            var policy = new PolicyDownload();
            var settings = config.copySettings();
            settings.file_keys = ['test'];

            test.mockAwsSdk.deferAfterS3HeadObject  = function(callback){ callback(null,{lastModified: 'test-timestamp'}); };
            test.mockAwsSdk.deferAfterS3GetObject   = function(callback){ callback('getObject-error'); };

            policy.apply({},settings,function(){
                downloadsDIR.should.eql('downloads');
                deletedFILES.should.eql([]);
                renamedFILES.should.eql([]);
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - consider: test',
                    'ERROR - download error: getObject-error test'
                ]);
                test.mockAwsSdk.checkMockState([['s3.headObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}],['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}]]);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);

                done();
            }, done);
        });

        it('should record a writeFile error',function(done){
            var policy = new PolicyDownload();
            var settings = config.copySettings();
            settings.file_keys = ['test'];

            test.mockAwsSdk.deferAfterS3HeadObject  = function(callback){ callback(null,{lastModified: 'test-timestamp'}); };
            test.mockAwsSdk.deferAfterS3GetObject   = function(callback){ callback(null,{Body: 'test-body'}); };

            test.mockHelpers.writeFile = function(path,data,callback){
                path.should.eql('downloads/test.tmp');
                data.should.eql('test-body');
                callback('writeFile-error')
            };

            policy.apply({},settings,function(){
                test.asyncDone(done,function(){
                    downloadsDIR.should.eql('downloads');
                    deletedFILES.should.eql([]);
                    renamedFILES.should.eql([]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - consider: test',
                        'ERROR - download error: writeFile-error test'
                    ]);
                    test.mockAwsSdk.checkMockState([['s3.headObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}],['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}]]);
                    test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);
                });
            }, done);
        });

        it('should detect and skip AWS errors',function(done){
            var policy = new PolicyDownload();
            var settings = config.copySettings();
            settings.file_keys = ['test1','test2'];

            test.mockAwsSdk.deferAfterS3HeadObject  = function(callback){ callback(null,{LastModified: 'test-timestamp',ContentLength: 9}); };
            test.mockAwsSdk.deferAfterS3GetObject   = function(callback){ callback('AWS error',null); };

            policy.apply({},settings,function(){
                test.asyncDone(done,function() {
                    downloadsDIR.should.eql('downloads');
                    deletedFILES.should.eql([]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - consider: test1',
                        'ERROR - download error: AWS error test1',
                        'DEBUG - consider: test2',
                        'ERROR - download error: AWS error test2'
                    ]);
                    test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);
                    test.mockAwsSdk.checkMockState([
                        ['s3.headObject', {Bucket: 'unknown-s3-bucket', Key: 'test1'}],['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test1'}],
                        ['s3.headObject', {Bucket: 'unknown-s3-bucket', Key: 'test2'}],['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test2'}]
                    ]);
                });
            },done);
        });

        it('should detect and skip file IO errors',function(done){
            var policy = new PolicyDownload();
            var settings = config.copySettings();
            settings.file_keys = ['test1','test2'];

            test.mockAwsSdk.deferAfterS3HeadObject  = function(callback){ callback(null,{LastModified: 'test-timestamp',ContentLength: 9}); };
            test.mockAwsSdk.deferAfterS3GetObject   = function(callback){ callback(null,{Body: 'test-body'}); };

            test.mockHelpers.writeFile = function(path,data,callback){ callback(null); };

            test.mockHelpers.fileExists = function(filename){
                return filename === 'downloads/test1.tmp' || filename === 'downloads/test2.tmp' ? {size: 8} : null;
            };

            policy.apply({},settings,function(){
                test.asyncDone(done,function() {
                    downloadsDIR.should.eql('downloads');
                    deletedFILES.should.eql(['downloads/test1.tmp','downloads/test2.tmp']);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - consider: test1',
                        'ERROR - download error: Invalid file size in S3 test1',
                        'DEBUG - consider: test2',
                        'ERROR - download error: Invalid file size in S3 test2'
                    ]);
                    test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);
                    test.mockAwsSdk.checkMockState([
                        ['s3.headObject', {Bucket: 'unknown-s3-bucket', Key: 'test1'}],['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test1'}],
                        ['s3.headObject', {Bucket: 'unknown-s3-bucket', Key: 'test2'}],['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test2'}]
                    ]);
                });
            },done);
        });

        it('should download a file',function(done){
            var policy = new PolicyDownload();
            var settings = config.copySettings();
            settings.file_keys = ['test'];

            test.mockAwsSdk.deferAfterS3HeadObject  = function(callback){ callback(null,{LastModified: 'test-timestamp',ContentLength: 9}); };
            test.mockAwsSdk.deferAfterS3GetObject   = function(callback){ callback(null,{Body: 'test-body'}); };

            test.mockHelpers.writeFile = function(path,data,callback){
                path.should.eql('downloads/test.tmp');
                data.should.eql('test-body');
                callback(null);
            };

            test.mockHelpers.fileExists = function(filename){ return filename === 'downloads/test.tmp' ? {size: 9} : null; }; // NOTE - ensure that 'downloads/test.tmp' "exists"

            policy.apply({},settings,function(){
                downloadsDIR.should.eql('downloads');
                deletedFILES.should.eql([]);
                renamedFILES.should.eql([['downloads/test.tmp','downloads/test']]);
                renamedFILES = [];
                deletedFILES = [];
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - consider: test',
                    '...downloaded: downloads/test'
                ]);
                test.mockAwsSdk.checkMockState([['s3.headObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}],['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}]]);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);

                test.mockHelpers.fileExists = function(filename){ return {size: 9} }; // NOTE - ensure that 'downloads/test.*' exists

                policy.apply({},settings,function(){
                    test.asyncDone(done,function() {
                        downloadsDIR.should.eql('downloads');
                        deletedFILES.should.eql([]);
                        renamedFILES.should.eql([]);
                        test.mockLogger.checkMockLogEntries([
                            'DEBUG - consider: test',
                            'DEBUG - ...already downloaded'
                        ]);
                        test.mockAwsSdk.checkMockState([['s3.headObject', {Bucket: 'unknown-s3-bucket', Key: 'test'}]]);
                    });
                },done);
            },done);
        });

        it('should overwrite an outdated file',function(done){
            var policy = new PolicyDownload();
            var settings = config.copySettings();
            settings.file_keys = ['test'];

            test.mockAwsSdk.deferAfterS3HeadObject  = function(callback){ callback(null,{LastModified: 'test-timestamp',ContentLength: 9}); };
            test.mockAwsSdk.deferAfterS3GetObject   = function(callback){ callback(null,{Body: 'test-body'}); };

            test.mockHelpers.writeFile = function(path,data,callback){
                path.should.eql('downloads/test.tmp');
                data.should.eql('test-body');
                callback(null);
            };

            test.mockHelpers.fileExists = function(filename){ return {size: 9}; };

            policy.lastTimestamps = { 'test': 'old-timestamp' };

            policy.apply({},settings,function(){
                test.asyncDone(done,function() {
                    deletedFILES.should.eql(['downloads/test']);
                    renamedFILES.should.eql([['downloads/test.tmp','downloads/test']]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - consider: test',
                        '...downloaded: downloads/test'
                    ]);
                    test.mockAwsSdk.checkMockState([['s3.headObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}],['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}]]);
                    test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);
                },done);
            },done);
        });
    });

    describe('deleteLeftoverFiles',function(){
        it('should record an error',function(done){
            var policy = new PolicyDownload();

            policy.setupApplyState({},{},function() { true.should.not.be.ok; },function(err){
                err.should.eql('test-error');
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - delete: test',
                    'ERROR - policy error: test-error'
                ]);
                done();
            });

            policy.filesToDelete = ['test'];
            test.mockHelpers.unlinkSync = function(target) { throw 'test-error'; };

            policy.deleteLeftoverFiles();
        })
    });
});