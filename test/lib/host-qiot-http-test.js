var test = require('../test');

var os = require('os');

var QiotHttpHost = require(process.cwd() + '/lib/host-qiot-http');

describe('QiotHttpHost',function() {

    var config,context;

    beforeEach(function () {
        test.mockery.enable();
        test.mockery.warnOnReplace(false);
        test.mockery.registerAllowables(['lodash','http-status-codes','./config','./logger',test.configGuard.requirePath]);
        test.mockery.registerMock('https', test.mockHTTPS);
        test.mockHTTPS.resetMock();
        test.mockery.registerMock('./logger', test.mockLogger);
        test.mockLogger.resetMock();
        test.mockery.registerMock('./helpers', test.mockHelpers);
        test.mockHelpers.resetMock();

        config = test.configGuard.beginGuarding();

        test.mockHelpers.resetMock();

        test.mockLogger.debugging = true;

        os.hostname = function(){ return 'TESTHOST'; }
    });

    afterEach(function () {
        delete config.settings.qiot_account_token;

        test.mockLogger.debugging = false;

        test.configGuard.finishGuarding();
        test.mockHelpers.checkMockFiles();
        test.mockLogger.checkMockLogEntries();
        test.mockery.deregisterAll();
        test.mockery.disable();
    });

    describe('findIdentity',function(){
        it('should use the environment variable QIOT_IDENTITY override MAC addresses as the identity',function(){
            test.mockHelpers.processENV.QIOT_IDENTITY = 'TEST';

            var host = new QiotHttpHost();
            host.findIdentity().should.eql([
                { type: 'ENV', value: 'TEST' }
            ]);
        });

        it('should find the external mac addresses in the os as identity values',function(){
            var host = new QiotHttpHost();
            host.findIdentity().should.eql([
                { type: 'HOSTNAME', value: 'TESTHOST' }
            ]);
        });
    });

    describe('ackMailboxMessage',function(){
        it('should detect ack failure',function(done){
            var host = new QiotHttpHost();

            test.mockHTTPS.statusCode = 403;

            host.ackMailboxMessage({qiot_thing_token: 'THING-TOKEN'},{id: 1,payload: "{}"},function() { done('unexpected success'); },function(error){
                test.asyncDone(done,function(){
                    error.should.eql('ack failure: Forbidden');
                    host.messageQueue.should.eql([]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - mailbox delivery: {"id":1,"payload":"{}"}',
                        'DEBUG - host POST /1/a/THING-TOKEN: {"status":"success","command_id":1}',
                        'DEBUG - host status: Forbidden'
                    ]);
                });
            });
        })
    });

    describe('contact - no account token',function(){
        it('should fail without an account token',function(done){
            var host = new QiotHttpHost();

            host.contact({}).then(function(result) { done('unexpected success'); },function(error){
                error.should.eql('no account token');
                host.messageQueue.should.eql([]);
                done();
            });
        })
    });

    describe('contact - register', function () {
        beforeEach(function(){
            context = {};
            config.settings.qiot_account_token = 'ACCOUNT-TOKEN';
        });

        afterEach(function(){
            delete config.settings.qiot_account_token;
        });

        it('should report that registration is required',function(){
            var host = new QiotHttpHost();

            host.registrationRequired(context).should.be.ok;
        });

        it('should handle unsuccessful responses from the server',function(done){
            var host = new QiotHttpHost();

            test.mockHTTPS.statusCode = 403;

            host.contact(context).then(function() { done('unexpected success'); },function(error){
                test.asyncDone(done,function(){
                    test.mockHTTPS.lastOptions.should.eql({
                        host: 'api.qiot.io',
                        port: 443,
                        path: '/1/r',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'QIOT ACCOUNT-TOKEN',
                            'Content-Length': 81
                        }
                    });
                    test.mockHTTPS.checkWritten(['{"identity":[{"type":"HOSTNAME","value":"TESTHOST"}],"label":"HOSTNAME-TESTHOST"}',null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/r: {"identity":[{"type":"HOSTNAME","value":"TESTHOST"}],"label":"HOSTNAME-TESTHOST"}',
                        'DEBUG - host status: Forbidden'
                    ]);
                    error.should.eql('registration rejected: Forbidden');
                    host.messageQueue.should.eql([{
                        state:      'unspecified',
                        state_id:   -1,
                        action:     'unspecified',
                        action_id:  -1,
                        version:    'unspecified'
                    }]);
                });
            },done);
        });

        it('should perform a registration if no qiot_account_token exists in the config',function(done){
            var host = new QiotHttpHost();

            test.mockHTTPS.deferAfterEnd = function(){
                test.asyncMidpoint(done,function(){
                    (!!test.mockHTTPS.events.data).should.be.ok;
                    test.mockHTTPS.events.data(JSON.stringify({thing: {account_token: 'ACCOUNT-TOKEN',collection_token: 'COLLECTION-TOKEN',thing_token: 'THING-TOKEN'}}));
                    (!!test.mockHTTPS.events.end).should.be.ok;
                    test.mockHTTPS.events.end();
                });
            };

            host.contact(context).then(function(context){
                test.asyncDone(done,function(){
                    test.mockHTTPS.lastOptions.should.eql({
                        host: 'api.qiot.io',
                        port: 443,
                        path: '/1/r',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'QIOT ACCOUNT-TOKEN',
                            'Content-Length': 81
                        }
                    });
                    test.mockHTTPS.checkWritten(['{"identity":[{"type":"HOSTNAME","value":"TESTHOST"}],"label":"HOSTNAME-TESTHOST"}',null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/r: {"identity":[{"type":"HOSTNAME","value":"TESTHOST"}],"label":"HOSTNAME-TESTHOST"}',
                        'DEBUG - host output: {"thing":{"account_token":"ACCOUNT-TOKEN","collection_token":"COLLECTION-TOKEN","thing_token":"THING-TOKEN"}}',
                        'DEBUG - host status: OK',
                        'DEBUG - registration received'
                    ]);

                    context.should.eql({state: 'registered',qiot_collection_token: 'COLLECTION-TOKEN',qiot_thing_token: 'THING-TOKEN'});
                    host.messageQueue.should.eql([{
                        state:      'unspecified',
                        state_id:   -1,
                        action:     'unspecified',
                        action_id:  -1,
                        version:    'unspecified'
                    }]);
                });
            },done);
        });

        it('should report an error if no registration found',function(done){
            var host = new QiotHttpHost();

            test.mockHTTPS.deferAfterEnd = function(){
                test.asyncMidpoint(done,function(){
                    (!!test.mockHTTPS.events.data).should.be.ok;
                    test.mockHTTPS.events.data('{}');
                    (!!test.mockHTTPS.events.end).should.be.ok;
                    test.mockHTTPS.events.end();
                });
            };

            host.contact(context).then(function(context){ done('error expected -- success found'); },function(error){
                test.asyncDone(done,function() {
                    test.mockHTTPS.checkWritten(['{"identity":[{"type":"HOSTNAME","value":"TESTHOST"}],"label":"HOSTNAME-TESTHOST"}',null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/r: {"identity":[{"type":"HOSTNAME","value":"TESTHOST"}],"label":"HOSTNAME-TESTHOST"}',
                        'DEBUG - host output: {}',
                        'DEBUG - host status: OK'
                    ]);
                    error.should.eql('no registration received');
                    context.should.eql({});
                    host.messageQueue.should.eql([{
                        state:      'unspecified',
                        state_id:   -1,
                        action:     'unspecified',
                        action_id:  -1,
                        version:    'unspecified'
                    }]);
                });
            });
        });
    });

    describe('contact - message', function () {
        beforeEach(function () {
            context = {qiot_thing_token: 'THING-TOKEN'};
            config.settings.qiot_account_token = 'ACCOUNT-TOKEN';
        });

        it('should report that registration is NOT required', function () {
            var host = new QiotHttpHost();

            host.registrationRequired(context).should.be.not.ok;
        });

        it('should handle unsuccessful responses from the server for message delivery', function (done) {
            var host = new QiotHttpHost();

            test.mockHTTPS.statusCode = 403;

            host.contact(context).then(function () {
                done('unexpected success');
            }, function (error) {
                test.asyncDone(done, function () {
                    test.mockHTTPS.lastOptions.should.eql({
                        host: 'api.qiot.io',
                        port: 443,
                        path: '/1/l/THING-TOKEN',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'QIOT ACCOUNT-TOKEN',
                            'Content-Length': 114
                        }
                    });
                    test.mockHTTPS.checkWritten(['{"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}', null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}',
                        'DEBUG - host status: Forbidden'
                    ]);

                    error.should.eql('delivery failure: Forbidden');
                    host.messageQueue.should.eql([{
                        state:      'unspecified',
                        state_id:   -1,
                        action:     'unspecified',
                        action_id:  -1,
                        version:    'unspecified'
                    }]);
                });
            }, done);
        });

        it('should handle unsuccessful responses from the server for mailbox failure', function (done) {
            var host = new QiotHttpHost();

            test.mockHTTPS.statusCode = 204;

            test.mockHTTPS.deferAfterEnd = function () {
                test.asyncMidpoint(done, function () {
                    (!!test.mockHTTPS.events.end).should.be.ok;
                    test.mockHTTPS.events.end();

                    test.mockHTTPS.statusCode = 403;
                    test.mockHTTPS.deferAfterEnd = null;
                });
            };

            host.contact(context).then(function () { done('unexpected success'); },function (error) {
                test.asyncDone(done, function () {
                    test.mockHTTPS.requested.should.eql([
                        {
                            host: 'api.qiot.io',
                            port: 443,
                            path: '/1/l/THING-TOKEN',
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'QIOT ACCOUNT-TOKEN',
                                'Content-Length': 114
                            }
                        },
                        {
                            host: 'api.qiot.io',
                            port: 443,
                            path: '/1/m/THING-TOKEN',
                            method: 'GET',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'QIOT ACCOUNT-TOKEN'
                            }
                        }
                    ]);
                    test.mockHTTPS.checkWritten([
                        '{"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}', null,
                        null
                    ]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}',
                        'DEBUG - host status: No Content',
                        'DEBUG - host GET /1/m/THING-TOKEN: null',
                        'DEBUG - host status: Forbidden'
                    ]);
                    error.should.eql('mailbox failure: Forbidden');
                    host.messageQueue.should.eql([]);
                });
            }, done);
        });

        it('should send a status message when a qiot_account_token exists in the config', function (done) {
            var host = new QiotHttpHost();

            test.mockHTTPS.statusCode = 204;

            context.result = {count: 1};
            host.contact(context).then(function (context) {
                test.asyncDone(done, function () {
                    test.mockHTTPS.requested.should.eql([
                        {
                            host: 'api.qiot.io',
                            port: 443,
                            path: '/1/l/THING-TOKEN',
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'QIOT ACCOUNT-TOKEN',
                                'Content-Length': 135
                            }
                        },
                        {
                            host: 'api.qiot.io',
                            port: 443,
                            path: '/1/m/THING-TOKEN',
                            method: 'GET',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'QIOT ACCOUNT-TOKEN'
                            }
                        }
                    ]);
                    test.mockHTTPS.checkWritten([
                        '{"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1,"result":{"count":1}}]}', null,
                        null
                    ]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1,"result":{"count":1}}]}',
                        'DEBUG - host status: No Content',
                        'DEBUG - host GET /1/m/THING-TOKEN: null',
                        'DEBUG - host status: No Content'
                    ]);
                    context.should.eql({qiot_thing_token: 'THING-TOKEN'});
                    host.messageQueue.should.eql([]);
                });
            }, done);
        });

        it('should catch an error handling message data', function (done) {
            var host = new QiotHttpHost();

            test.mockHTTPS.deferAfterEnd = function () {
                test.asyncMidpoint(done, function () {
                    (!!test.mockHTTPS.events.data).should.be.ok;
                    test.mockHTTPS.events.data(null);
                    (!!test.mockHTTPS.events.end).should.be.ok;
                    test.mockHTTPS.events.end();
                });
            };

            host.contact(context).then(function (context) {
                done('error expected -- success found');
            }, function (error) {
                test.asyncDone(done, function () {
                    test.mockHTTPS.checkWritten(['{"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}', null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}',
                        'DEBUG - host status: OK'
                    ]);
                    error.toString().should.eql("TypeError: Cannot read property 'toString' of null");
                    context.should.eql({qiot_thing_token: 'THING-TOKEN'});
                    host.messageQueue.should.eql([{
                        state:      'unspecified',
                        state_id:   -1,
                        action:     'unspecified',
                        action_id:  -1,
                        version:    'unspecified'
                    }]);
                });
            });
        });

        it('should catch invalid message json', function (done) {
            var host = new QiotHttpHost();

            test.mockHTTPS.deferAfterEnd = function () {
                test.asyncMidpoint(done, function () {
                    test.mockHTTPS.deferAfterEnd = null;
                    (!!test.mockHTTPS.events.data).should.be.ok;
                    test.mockHTTPS.events.data('{');
                    (!!test.mockHTTPS.events.end).should.be.ok;
                    test.mockHTTPS.events.end();
                });
            };

            host.contact(context).then(function (context) {
                done('error expected -- success found');
            }, function (error) {
                test.asyncDone(done, function () {
                    test.mockHTTPS.checkWritten(['{"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}', null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}',
                        'DEBUG - host output: {',
                        'ERROR - json error: SyntaxError: Unexpected end of input',
                        'DEBUG - host status: OK'
                    ]);
                    error.toString().should.eql('no json received');
                    context.should.eql({qiot_thing_token: 'THING-TOKEN'});
                    host.messageQueue.should.eql([{
                        state:      'unspecified',
                        state_id:   -1,
                        action:     'unspecified',
                        action_id:  -1,
                        version:    'unspecified'
                    }]);
                });
            });
        });

        it('should receive valid message and mailbox json', function (done) {
            var host = new QiotHttpHost();

            var data = '{}';
            test.mockHTTPS.deferAfterEnd = function () {
                test.asyncMidpoint(done, function () {
                    (!!test.mockHTTPS.events.data).should.be.ok;
                    test.mockHTTPS.events.data(data);
                    (!!test.mockHTTPS.events.end).should.be.ok;
                    test.mockHTTPS.events.end();
                    data = '{"id":1,"payload":"{\\"state\\":\\"test\\"}"}';
                });
            };

            host.contact(context).then(function (context) {
                test.asyncDone(done, function () {
                    test.mockHTTPS.checkWritten([
                        '{"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}',
                        null,
                        null,
                        '{"status":"success","command_id":1}',
                        null
                    ]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}',
                        'DEBUG - host output: {}',
                        'DEBUG - host status: OK',
                        'DEBUG - host GET /1/m/THING-TOKEN: null',
                        'DEBUG - host output: {"id":1,"payload":"{\\"state\\":\\"test\\"}"}',
                        'DEBUG - host status: OK',
                        'DEBUG - mailbox delivery: {"id":1,"payload":"{\\"state\\":\\"test\\"}"}',
                        'DEBUG - host POST /1/a/THING-TOKEN: {"status":"success","command_id":1}',
                        'DEBUG - host output: {"id":1,"payload":"{\\"state\\":\\"test\\"}"}',
                        'DEBUG - host status: OK'
                    ]);
                    context.should.eql({
                        qiot_thing_token: 'THING-TOKEN',
                        last_mailbox_id: 1,
                        state: 'test'
                    });
                    host.messageQueue.should.eql([]);
                });
            }, done);
        });

        it('should receive valid message and already-seen-mailbox json', function (done) {
            var host = new QiotHttpHost();

            var data = '{}';
            test.mockHTTPS.deferAfterEnd = function () {
                test.asyncMidpoint(done, function () {
                    (!!test.mockHTTPS.events.data).should.be.ok;
                    test.mockHTTPS.events.data(data);
                    (!!test.mockHTTPS.events.end).should.be.ok;
                    test.mockHTTPS.events.end();
                    data = '{"id":1,"payload":"{\\"state\\":\\"test\\"}"}';
                });
            };

            context.last_mailbox_id = 1;

            host.contact(context).then(function (context) {
                test.asyncDone(done, function () {
                    test.mockHTTPS.checkWritten([
                        '{"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}',
                        null,
                        null,
                        '{"status":"success","command_id":1}',
                        null
                    ]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}',
                        'DEBUG - host output: {}',
                        'DEBUG - host status: OK',
                        'DEBUG - host GET /1/m/THING-TOKEN: null',
                        'DEBUG - host output: {"id":1,"payload":"{\\"state\\":\\"test\\"}"}',
                        'DEBUG - host status: OK',
                        'DEBUG - skip mailbox message: {"id":1,"payload":"{\\"state\\":\\"test\\"}"}',
                        'DEBUG - host POST /1/a/THING-TOKEN: {"status":"success","command_id":1}',
                        'DEBUG - host output: {"id":1,"payload":"{\\"state\\":\\"test\\"}"}',
                        'DEBUG - host status: OK'
                    ]);
                    context.should.eql({qiot_thing_token: 'THING-TOKEN',last_mailbox_id: 1});
                    host.messageQueue.should.eql([]);
                });
            }, done);
        });

        it('should receive valid message and invalid payload', function (done) {
            var host = new QiotHttpHost();

            var data = '{}';
            test.mockHTTPS.deferAfterEnd = function () {
                test.asyncMidpoint(done, function () {
                    (!!test.mockHTTPS.events.data).should.be.ok;
                    test.mockHTTPS.events.data(data);
                    (!!test.mockHTTPS.events.end).should.be.ok;
                    test.mockHTTPS.events.end();
                    data = '{"id":1}';
                });
            };

            host.contact(context).then(function (context) {
                test.asyncDone(done, function () {
                    test.mockHTTPS.checkWritten([
                        '{"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}',
                        null,
                        null,
                        '{"status":"failure","command_id":1}',
                        null
                    ]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}',
                        'DEBUG - host output: {}',
                        'DEBUG - host status: OK',
                        'DEBUG - host GET /1/m/THING-TOKEN: null',
                        'DEBUG - host output: {"id":1}',
                        'DEBUG - host status: OK',
                        'ERROR - json error: SyntaxError: Unexpected token u',
                        'ERROR - invalid mailbox payload: undefined',
                        'DEBUG - host POST /1/a/THING-TOKEN: {"status":"failure","command_id":1}',
                        'DEBUG - host output: {"id":1}',
                        'DEBUG - host status: OK'
                    ]);
                    context.should.eql({qiot_thing_token: 'THING-TOKEN'});
                    host.messageQueue.should.eql([]);
                });
            }, done);
        });
    });
});