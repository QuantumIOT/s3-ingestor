var test = require('../test');

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
                { type: 'SN', value: 'TEST' }
            ]);
        });

        it('should find the external mac addresses in the os as identity values',function(){
            test.mockHelpers.networkInterfaces = function (){ return {
                lo0:
                    [ { address: '::1',
                        netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
                        family: 'IPv6',
                        mac: '00:00:00:00:00:00',
                        scopeid: 0,
                        internal: true },
                        { address: '127.0.0.1',
                            netmask: '255.0.0.0',
                            family: 'IPv4',
                            mac: '00:00:00:00:00:00',
                            internal: true },
                        { address: 'fe80::1',
                            netmask: 'ffff:ffff:ffff:ffff::',
                            family: 'IPv6',
                            mac: '00:00:00:00:00:00',
                            scopeid: 1,
                            internal: true } ],
                en0:
                    [ { address: 'fe80::a299:9bff:fe05:daa3',
                        netmask: 'ffff:ffff:ffff:ffff::',
                        family: 'IPv6',
                        mac: 'a0:99:9b:05:da:a3',
                        scopeid: 5,
                        internal: false },
                        { address: '192.168.1.7',
                            netmask: '255.255.255.0',
                            family: 'IPv4',
                            mac: 'a0:99:9b:05:da:a3',
                            internal: false } ],
                awdl0:
                    [ { address: 'fe80::34ec:49ff:fe47:fbd8',
                        netmask: 'ffff:ffff:ffff:ffff::',
                        family: 'IPv6',
                        mac: '36:ec:49:47:fb:d8',
                        scopeid: 10,
                        internal: false } ],
                utun0:
                    [ { address: 'fe80::fc12:2690:40e0:317b',
                        netmask: 'ffff:ffff:ffff:ffff::',
                        family: 'IPv6',
                        mac: '00:00:00:00:00:00',
                        scopeid: 11,
                        internal: false } ],
                utun1:
                    [ { address: 'fe80::e48b:9afa:7f45:4727',
                        netmask: 'ffff:ffff:ffff:ffff::',
                        family: 'IPv6',
                        mac: '00:00:00:00:00:00',
                        scopeid: 12,
                        internal: false } ],
                en4:
                    [ { address: 'fe80::426c:8fff:fe46:79fb',
                        netmask: 'ffff:ffff:ffff:ffff::',
                        family: 'IPv6',
                        mac: '40:6c:8f:46:79:fb',
                        scopeid: 4,
                        internal: false },
                        { address: '192.168.1.13',
                            netmask: '255.255.255.0',
                            family: 'IPv4',
                            mac: '40:6c:8f:46:79:fb',
                            internal: false } ] };};

            var host = new QiotHttpHost();
            host.findIdentity().should.eql([
                { type: 'MAC', value: 'a0:99:9b:05:da:a3' },
                { type: 'MAC', value: '36:ec:49:47:fb:d8' },
                { type: 'MAC', value: '40:6c:8f:46:79:fb' }
            ]);
        });
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
            test.mockHelpers.networkInterfaces = function (){ return {if: [{mac: 'a0:b0:c0:d0:e0:f0'}]}; }
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
                            'Content-Length': 89
                        }
                    });
                    test.mockHTTPS.checkWritten(['{"identity":[{"type":"MAC","value":"a0:b0:c0:d0:e0:f0"}],"label":"MAC-a0:b0:c0:d0:e0:f0"}',null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/r: {"identity":[{"type":"MAC","value":"a0:b0:c0:d0:e0:f0"}],"label":"MAC-a0:b0:c0:d0:e0:f0"}',
                        'DEBUG - host status: Forbidden'
                    ]);

                    error.should.eql('registration rejected: Forbidden');
                    host.messageQueue.should.eql([{action: 'unspecified', version: 'unspecified', info: {}, stats: {}}]);
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
                            'Content-Length': 89
                        }
                    });
                    test.mockHTTPS.checkWritten(['{"identity":[{"type":"MAC","value":"a0:b0:c0:d0:e0:f0"}],"label":"MAC-a0:b0:c0:d0:e0:f0"}',null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/r: {"identity":[{"type":"MAC","value":"a0:b0:c0:d0:e0:f0"}],"label":"MAC-a0:b0:c0:d0:e0:f0"}',
                        'DEBUG - host output: {"thing":{"account_token":"ACCOUNT-TOKEN","collection_token":"COLLECTION-TOKEN","thing_token":"THING-TOKEN"}}',
                        'DEBUG - host status: OK',
                        'DEBUG - registration received'
                    ]);

                    context.should.eql({state: 'registered',qiot_collection_token: 'COLLECTION-TOKEN',qiot_thing_token: 'THING-TOKEN'});
                    host.messageQueue.should.eql([{action: 'unspecified', version: 'unspecified', info: {}, stats: {}}]);
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
                    test.mockHTTPS.checkWritten(['{"identity":[{"type":"MAC","value":"a0:b0:c0:d0:e0:f0"}],"label":"MAC-a0:b0:c0:d0:e0:f0"}',null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/r: {"identity":[{"type":"MAC","value":"a0:b0:c0:d0:e0:f0"}],"label":"MAC-a0:b0:c0:d0:e0:f0"}',
                        'DEBUG - host output: {}',
                        'DEBUG - host status: OK'
                    ]);
                    error.should.eql('no registration received');
                    context.should.eql({});
                    host.messageQueue.should.eql([{action: 'unspecified', version: 'unspecified', info: {}, stats: {}}]);
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
                            'Content-Length': 84
                        }
                    });
                    test.mockHTTPS.checkWritten(['{"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}', null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}',
                        'DEBUG - host status: Forbidden'
                    ]);

                    error.should.eql('delivery failure: Forbidden');
                    host.messageQueue.should.eql([{
                        action: 'unspecified',
                        version: 'unspecified',
                        info: {},
                        stats: {}
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

            host.contact(context).then(function () {
                done('unexpected success');
            }, function (error) {
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
                                'Content-Length': 84
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
                        '{"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}', null,
                        null
                    ]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}',
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
                                'Content-Length': 84
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
                        '{"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}', null,
                        null
                    ]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}',
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
                    test.mockHTTPS.checkWritten(['{"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}', null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}',
                        'DEBUG - host status: OK'
                    ]);
                    error.toString().should.eql("TypeError: Cannot read property 'toString' of null");
                    context.should.eql({qiot_thing_token: 'THING-TOKEN'});
                    host.messageQueue.should.eql([{
                        action: "unspecified",
                        version: "unspecified",
                        info: {},
                        stats: {}
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
                    test.mockHTTPS.checkWritten(['{"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}', null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}',
                        'DEBUG - host output: {',
                        'ERROR - json error: SyntaxError: Unexpected end of input',
                        'DEBUG - host status: OK'
                    ]);
                    error.toString().should.eql('no json received');
                    context.should.eql({qiot_thing_token: 'THING-TOKEN'});
                    host.messageQueue.should.eql([{
                        action: "unspecified",
                        version: "unspecified",
                        info: {},
                        stats: {}
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
                    data = '{"time":"MAILBOX-TIME","state":"configured","content":{}}';
                });
            };

            host.contact(context).then(function (context) {
                test.asyncDone(done, function () {
                    test.mockHTTPS.checkWritten([
                        '{"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}', null,
                        null
                    ]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}',
                        'DEBUG - host output: {}',
                        'DEBUG - host status: OK',
                        'DEBUG - host GET /1/m/THING-TOKEN: null',
                        'DEBUG - host output: {"time":"MAILBOX-TIME","state":"configured","content":{}}',
                        'DEBUG - host status: OK',
                        'DEBUG - mailbox delivery{"time":"MAILBOX-TIME","state":"configured"}'
                    ]);
                    context.should.eql({
                        qiot_thing_token: 'THING-TOKEN',
                        thing_mailbox_time: 'MAILBOX-TIME',
                        state: 'configured'
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
                    data = '{"time":"MAILBOX-TIME","state":"configured","content":{}}';
                });
            };

            context.thing_mailbox_time = 'MAILBOX-TIME';

            host.contact(context).then(function (context) {
                test.asyncDone(done, function () {
                    test.mockHTTPS.checkWritten([
                        '{"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}', null,
                        null
                    ]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}',
                        'DEBUG - host output: {}',
                        'DEBUG - host status: OK',
                        'DEBUG - host GET /1/m/THING-TOKEN: null',
                        'DEBUG - host output: {"time":"MAILBOX-TIME","state":"configured","content":{}}',
                        'DEBUG - host status: OK'
                    ]);
                    context.should.eql({qiot_thing_token: 'THING-TOKEN', thing_mailbox_time: 'MAILBOX-TIME'});
                    host.messageQueue.should.eql([]);
                });
            }, done);
        });

        it('should receive valid message and mailbox-data-without-time json', function (done) {
            var host = new QiotHttpHost();

            var data = '{}';
            test.mockHTTPS.deferAfterEnd = function () {
                test.asyncMidpoint(done, function () {
                    (!!test.mockHTTPS.events.data).should.be.ok;
                    test.mockHTTPS.events.data(data);
                    (!!test.mockHTTPS.events.end).should.be.ok;
                    test.mockHTTPS.events.end();
                    data = '{"state":"configured","content":{}}';
                });
            };

            host.contact(context).then(function (context) {
                test.asyncDone(done, function () {
                    test.mockHTTPS.checkWritten([
                        '{"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}', null,
                        null
                    ]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/l/THING-TOKEN: {"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}',
                        'DEBUG - host output: {}',
                        'DEBUG - host status: OK',
                        'DEBUG - host GET /1/m/THING-TOKEN: null',
                        'DEBUG - host output: {"state":"configured","content":{}}',
                        'DEBUG - host status: OK'
                    ]);
                    context.should.eql({qiot_thing_token: 'THING-TOKEN'});
                    host.messageQueue.should.eql([]);
                });
            }, done);
        });
    });
});