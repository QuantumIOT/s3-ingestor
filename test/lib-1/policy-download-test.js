var test = require('../test');

var PolicyDownload = require(process.cwd() + '/lib/policy-download');
var config = require(process.cwd() + '/lib/config');

describe('PolicyDownload',function() {

    var downloadsDIR,downloadsFILES,deletedFILES;

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
            },function(err){ true.should.not.be.ok; done(); });
        });

        it('should delete all files with no file keys',function(done){
            var policy = new PolicyDownload();

            downloadsFILES = ['test'];
            policy.apply({},config.copySettings(),function(){
                downloadsDIR.should.eql('downloads');
                deletedFILES.should.eql(['downloads/test']);
                test.mockLogger.checkMockLogEntries(['DEBUG - delete: test']);
                done();
            },function(err){ true.should.not.be.ok; done(); });
        });

        it('should record an s3.headObject error',function(done){
            var policy = new PolicyDownload();
            var settings = config.copySettings();
            settings.file_keys = ['test'];

            test.mockAwsSdk.deferAfterS3HeadObject = function(callback){ callback('headObject-error'); };

            policy.apply({},settings,function(err){ true.should.not.be.ok; done(); },function(){
                downloadsDIR.should.eql('downloads');
                deletedFILES.should.eql([]);
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - consider: test',
                    'ERROR - policy error: headObject-error'
                ]);
                test.mockAwsSdk.checkMockState([['s3.headObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}]]);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);

                done();
            });
        });

        it('should record an s3.getObject error',function(done){
            var policy = new PolicyDownload();
            var settings = config.copySettings();
            settings.file_keys = ['test'];

            test.mockAwsSdk.deferAfterS3HeadObject  = function(callback){ callback(null,{lastModified: 'test-timestamp'}); };
            test.mockAwsSdk.deferAfterS3GetObject   = function(callback){ callback('getObject-error'); };

            policy.apply({},settings,function(err){ true.should.not.be.ok; done(); },function(){
                downloadsDIR.should.eql('downloads');
                deletedFILES.should.eql([]);
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - consider: test',
                    'ERROR - policy error: getObject-error'
                ]);
                test.mockAwsSdk.checkMockState([['s3.headObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}],['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}]]);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);

                done();
            });
        });

        it('should record a writeFile error',function(done){
            var policy = new PolicyDownload();
            var settings = config.copySettings();
            settings.file_keys = ['test'];

            test.mockAwsSdk.deferAfterS3HeadObject  = function(callback){ callback(null,{lastModified: 'test-timestamp'}); };
            test.mockAwsSdk.deferAfterS3GetObject   = function(callback){ callback(null,{Body: 'test-body'}); };

            test.mockHelpers.writeFile = function(path,data,callback){
                path.should.eql('downloads/test');
                data.should.eql('test-body');
                callback('writeFile-error')
            };

            policy.apply({},settings,function(err){ true.should.not.be.ok; done(); },function(){
                downloadsDIR.should.eql('downloads');
                deletedFILES.should.eql([]);
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - consider: test',
                    'ERROR - policy error: writeFile-error'
                ]);
                test.mockAwsSdk.checkMockState([['s3.headObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}],['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}]]);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);

                done();
            });
        });

        it('should download a file',function(done){
            var policy = new PolicyDownload();
            var settings = config.copySettings();
            settings.file_keys = ['test'];

            test.mockAwsSdk.deferAfterS3HeadObject  = function(callback){ callback(null,{LastModified: 'test-timestamp'}); };
            test.mockAwsSdk.deferAfterS3GetObject   = function(callback){ callback(null,{Body: 'test-body'}); };

            test.mockHelpers.writeFile = function(path,data,callback){
                path.should.eql('downloads/test');
                data.should.eql('test-body');
                callback(null);
            };

            policy.apply({},settings,function(){
                downloadsDIR.should.eql('downloads');
                deletedFILES.should.eql([]);
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - consider: test',
                    '...downloaded: downloads/test'
                ]);
                test.mockAwsSdk.checkMockState([['s3.headObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}],['s3.getObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}]]);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);

                test.mockHelpers.fileExists = function(){return true;}; // NOTE - ensure that 'downloads/test' "exists"

                policy.apply({},settings,function(){
                    downloadsDIR.should.eql('downloads');
                    deletedFILES.should.eql([]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - consider: test',
                        'DEBUG - ...already downloaded'
                    ]);
                    test.mockAwsSdk.checkMockState([['s3.headObject',{Bucket: 'unknown-s3-bucket',Key: 'test'}]]);

                    done();
                },function(err){ true.should.not.be.ok; done(); });
            },function(err){ true.should.not.be.ok; done(); });
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