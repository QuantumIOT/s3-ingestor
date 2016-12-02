var _ = require('lodash');
var test = require('../test');

var PolicySocket = require(process.cwd() + '/lib/policy-socket');
var config = require(process.cwd() + '/lib/config');

describe('PolicySocket',function() {

    beforeEach(function () {
        test.mockery.enable();
        test.mockery.warnOnReplace(false);
        test.mockery.registerAllowables(['./aws','./logger',test.configGuard.requirePath]);
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
        it('should start the socket and uploads',function(done){
            var policy = new PolicySocket();

            policy.apply({},config.copySettings({socket_port: 1234,socket_host: 'test-host'}),function(){ true.should.be.ok; },function(err){ true.should.not.be.ok; });

            test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);
            test.mockNET.checkSockets([[
                'on:data',
                'on:close',
                'on:error',
                'setTimeout:15000',
                'connect:test-host:1234'
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
    });

    describe('startUpload',function(){
        it('should allow multiple executions without stopping',function(done){
            var policy = new PolicySocket();

            policy.settings = config.copySettings();

            policy.startUpload();
            policy.startUpload();
            policy.stopUpload();
            policy.startUpload();
            policy.startUpload();
            policy.stopUpload();
            _.defer(function(){
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - upload started',
                    'DEBUG - upload already started',
                    'DEBUG - upload stopped',
                    'DEBUG - upload started',
                    'DEBUG - upload already started',
                    'DEBUG - upload stopped',
                    'DEBUG - queue checking stopped',
                    'DEBUG - queue checking stopped'
                ]);
                test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);
                done();
            });
        });
    });

    describe('ensureSocket',function(){
        it('should allow being called multiple times',function(){
            var policy = new PolicySocket();

            policy.settings = config.copySettings({socket_port: 1234,socket_host: 'test-host'});

            (!!policy.socket).should.be.not.ok;
            (!!policy.stats).should.be.not.ok;
            test.mockLogger.checkMockLogEntries();

            policy.ensureSocket();
            policy.ensureSocket();

            (!!policy.socket).should.be.ok;
            policy.stats.status.should.eql('pending');
            test.mockNET.checkSockets([[
                'on:data',
                'on:close',
                'on:error',
                'setTimeout:15000',
                'connect:test-host:1234'
            ]]);
        });

        it('should connect',function(){
            var policy = new PolicySocket();

            policy.settings = config.copySettings({socket_port: 1234,socket_host: 'test-host'});

            policy.ensureSocket();

            policy.socket.topics['connect:test-host:1234']();
            test.mockLogger.checkMockLogEntries(['DEBUG - socket connected']);
            test.mockNET.resetMock();
        });

        it('should detect timeout',function(){
            var policy = new PolicySocket();

            policy.settings = config.copySettings({socket_port: 1234,socket_host: 'test-host'});

            policy.ensureSocket();

            policy.socket.topics['setTimeout:15000']();
            policy.stats.should.eql({added: 0,skipped: 0,ignored: 0,sent: 0,errors: 1,status: 'error: timeout'});
            test.mockLogger.checkMockLogEntries(['ERROR - socket error: timeout']);
            test.mockNET.resetMock();
        });

        it('should detect close',function(){
            var policy = new PolicySocket();

            policy.settings = config.copySettings({socket_port: 1234,socket_host: 'test-host'});

            policy.ensureSocket();

            policy.socket.topics['on:close']();
            (!!policy.socket).should.not.be.ok;
            policy.stats.status.should.eql('closed');
            test.mockLogger.checkMockLogEntries(['DEBUG - socket closed']);
            test.mockNET.resetMock();
        });

        it('should detect data on the socket and put in redis, but not for duplicates',function(done){
            var policy = new PolicySocket();

            policy.apply({},config.copySettings({socket_queue: 'test-queue',socket_port: 1234,socket_host: 'test-host'}),function(){ true.should.be.ok; },function(err){ true.should.not.be.ok; });

            test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);

            policy.socket.topics['connect:test-host:1234']();

            test.mockHelpers.isoTimestamp = function(){return 'test-timestamp';};

            policy.socket.topics['on:data']('test-data');

            policy.stats.should.eql({added: 1,skipped: 0,ignored: 0,sent: 0,errors: 0,status: 'connected'});

            policy.socket.topics['on:data']('test-data');

            policy.stats.should.eql({added: 1,skipped: 1,ignored: 0,sent: 0,errors: 0,status: 'connected'});

            policy.reset();

            _.defer(function(){
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - upload started',
                    'DEBUG - socket connected',
                    'DEBUG - call lpush: {"timestamp":"test-timestamp","data":"test-data"}',
                    'DEBUG - lpush success',
                    'DEBUG - skip same data',
                    'DEBUG - upload stopped',
                    'DEBUG - queue checking stopped'
                ]);
                test.mockRedis.snapshot().should.eql([{lpush: ['test-queue','{"timestamp":"test-timestamp","data":"test-data"}']}]);
                test.mockNET.resetMock();
                done();
            });
        });
    });

    describe('checkQueue',function(){
        it('should continue checking if brpop returns nothing',function(done){
            var policy = new PolicySocket();

            policy.settings = config.copySettings({socket_port: 1234,socket_host: 'test-host'});

            policy.startUpload();

            _.defer(function(){
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - upload started',
                    'DEBUG - call brpop',
                    'DEBUG - brpop response: null'
                ]);

                policy.stopUpload();

                _.defer(function(){
                    test.mockRedis.snapshot().should.eql([{brpop: undefined}]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - upload stopped',
                        'DEBUG - queue checking stopped'
                    ]);
                    test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);
                    done();
                });
            });
        });

        it('should detect no s3 connection and rpush the data back',function(done){
            var policy = new PolicySocket();

            policy.settings = config.copySettings({socket_queue: 'test-queue',socket_port: 1234,socket_host: 'test-host'});

            policy.startUpload();

            test.mockRedis.deferThen = true;
            test.mockRedis.lookup.brpop.push(['test-queue','{"timestamp":"test-timestamp","data":"test-data"}']);

            _.defer(function(){
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - upload started',
                    'DEBUG - call brpop'
                ]);

                policy.stopUpload();

                _.defer(function(){
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - upload stopped',
                        'DEBUG - brpop response: ["test-queue","{\\"timestamp\\":\\"test-timestamp\\",\\"data\\":\\"test-data\\"}"]',
                        'DEBUG - put popped payload back'
                    ]);
                    test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);
                    test.mockRedis.snapshot().should.eql([
                        {brpop: 'test-queue'},
                        {rpush: ['test-queue','{"timestamp":"test-timestamp","data":"test-data"}']}
                    ]);
                    done();
                })
            })
        });

        it('should ignore data that does not have key',function(done){
            var policy = new PolicySocket();

            policy.buildKey = function(){return null;};

            policy.settings = config.copySettings({socket_queue: 'test-queue',socket_port: 1234,socket_host: 'test-host'});

            policy.startUpload();
            policy.ensureSocket();

            test.mockRedis.lookup.brpop.push(['test-queue','{"timestamp":"test-timestamp","data":"test-data"}']);

            _.defer(function(){
                policy.stats.should.eql({added: 0,skipped: 0,ignored: 1,sent: 0,errors: 0,status: 'pending'});
                test.mockRedis.snapshot().should.eql([{brpop: 'test-queue'}]);
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - upload started',
                    'DEBUG - call brpop',
                    'DEBUG - brpop response: ["test-queue","{\\"timestamp\\":\\"test-timestamp\\",\\"data\\":\\"test-data\\"}"]',
                    'DEBUG - ignore: test-timestamp'
                ]);

                policy.stopUpload();

                _.defer(function(){
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - upload stopped',
                        'DEBUG - queue checking stopped'
                    ]);
                    test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);
                    test.mockNET.resetMock();
                    done();
                })
            })
        });

        it('should retrieve data from redis to deliver to the S3',function(done){
            var policy = new PolicySocket();

            policy.apply({},config.copySettings({socket_queue: 'test-queue',socket_port: 1234,socket_host: 'test-host'}),function(){ true.should.be.ok; },function(err){ true.should.not.be.ok; });

            test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);

            policy.socket.topics['connect:test-host:1234']();

            test.mockHelpers.isoTimestamp = function(){return 'test-timestamp';};

            policy.socket.topics['on:data']('test-data');

            test.mockRedis.lookup.brpop.push(['test-queue','{"timestamp":"test-timestamp","data":"test-data"}']);

            test.mockAwsSdk.deferAfterS3PutObject = function(callback){ callback(null); };

            _.defer(function(){
                test.mockRedis.snapshot().should.eql([
                    {lpush: ['test-queue','{"timestamp":"test-timestamp","data":"test-data"}']},
                    {brpop: 'test-queue'}
                ]);

                policy.reset();

                setTimeout(function(){
                    policy.stats.should.eql({added: 1,skipped: 0,ignored: 0,sent: 1,errors: 0,status: 'connected'});
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - upload started',
                        'DEBUG - socket connected',
                        'DEBUG - call lpush: {"timestamp":"test-timestamp","data":"test-data"}',
                        'DEBUG - lpush success',
                        'DEBUG - call brpop',
                        'DEBUG - brpop response: ["test-queue","{\\"timestamp\\":\\"test-timestamp\\",\\"data\\":\\"test-data\\"}"]',
                        'DEBUG - upload: test-timestamp',
                        'DEBUG - upload stopped',
                        'DEBUG - queue checking stopped'
                    ]);
                    test.mockAwsSdk.checkMockState([['s3.putObject',{Bucket: 'unknown-s3-bucket',Key: 'test-timestamp',Body: 'test-data'}]])
                    test.mockNET.resetMock();
                    done();
                },10);
            });
        });

        it('should detect an s3.putObject error',function(done){
            var policy = new PolicySocket();

            policy.apply({},config.copySettings({socket_queue: 'test-queue',socket_port: 1234,socket_host: 'test-host'}),function(){ true.should.be.ok; },function(err){ true.should.not.be.ok; });

            test.mockHelpers.checkMockFiles([[config.settings.aws_keys_file,'default']]);

            policy.socket.topics['connect:test-host:1234']();

            test.mockHelpers.isoTimestamp = function(){return 'test-timestamp';};

            policy.socket.topics['on:data']('test-data');

            test.mockRedis.lookup.brpop.push(['test-queue','{"timestamp":"test-timestamp","data":"test-data"}']);

            test.mockAwsSdk.deferAfterS3PutObject = function(callback){ callback('putObject-error'); };

            _.defer(function(){
                policy.reset();

                setTimeout(function(){
                    policy.stats.should.eql({added: 1,skipped: 0,ignored: 0,sent: 0,errors: 1,status: 'error: putObject-error'});
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - upload started',
                        'DEBUG - socket connected',
                        'DEBUG - call lpush: {"timestamp":"test-timestamp","data":"test-data"}',
                        'DEBUG - lpush success',
                        'DEBUG - call brpop',
                        'DEBUG - brpop response: ["test-queue","{\\"timestamp\\":\\"test-timestamp\\",\\"data\\":\\"test-data\\"}"]',
                        'DEBUG - upload: test-timestamp',
                        'DEBUG - upload stopped',
                        'ERROR - socket error: putObject-error',
                        'DEBUG - put undelivered payload back',
                        'DEBUG - queue checking stopped'
                    ]);
                    test.mockRedis.snapshot().should.eql([
                        {lpush: ['test-queue','{"timestamp":"test-timestamp","data":"test-data"}']},
                        {brpop: 'test-queue'},
                        {rpush: ['test-queue','{"timestamp":"test-timestamp","data":"test-data"}']}
                    ]);

                    test.mockAwsSdk.checkMockState([['s3.putObject',{Bucket: 'unknown-s3-bucket',Key: 'test-timestamp',Body: 'test-data'}]]);
                    test.mockNET.resetMock();
                    done();
                },10);
            });
        });
    });
});