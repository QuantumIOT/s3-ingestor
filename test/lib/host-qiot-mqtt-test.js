var _ = require('lodash');
var test = require('../test');

var QiotMqttHost = require(process.cwd() + '/lib/host-qiot-mqtt');

describe('QiotMqttHost',function() {

    var config,context;

    beforeEach(function () {
        test.mockery.enable();
        test.mockery.warnOnReplace(false);
        test.mockery.registerAllowables(['lodash','http-status-codes','./config','./logger','./host-qiot-http',test.configGuard.requirePath]);
        test.mockery.registerMock('mqtt', test.mockMQTT);
        test.mockMQTT.resetMock();
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

    describe('contact - no account token',function(){
        it('should fail without an account token',function(done){
            var host = new QiotMqttHost();

            host.contact({}).then(function(result) { done('unexpected success'); },function(error){
                error.should.eql('no account token');
                done();
            });
        })
    });

    describe('contact - register', function () {
        beforeEach(function(){
            context                            = {};
            config.settings.qiot_account_token = 'ACCOUNT-TOKEN';
            test.mockHelpers.networkInterfaces = function (){ return {if: [{mac: '00:00:00:00:00:00'}]}; }
        });

        it('should report that registration is required',function(){
            var host = new QiotMqttHost();

            host.registrationRequired(context).should.be.ok;
        });

        it('should perform a registration if no qiot_account_token exists in the config',function(done){
            var host = new QiotMqttHost();

            test.mockHTTPS.deferAfterEnd = function(){
                test.asyncMidpoint(done,function(){
                    (!!test.mockHTTPS.events.data).should.be.ok;
                    test.mockHTTPS.events.data(JSON.stringify({thing: {account_token: 'ACCOUNT-TOKEN-2',collection_token: 'COLLECTION-TOKEN',token: 'THING-TOKEN'}}));
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
                    test.mockHTTPS.checkWritten(['{"identity":[{"type":"MAC","value":"00:00:00:00:00:00"}],"label":"MAC-00:00:00:00:00:00"}',null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST: {"identity":[{"type":"MAC","value":"00:00:00:00:00:00"}],"label":"MAC-00:00:00:00:00:00"}',
                        'DEBUG - host output: {"thing":{"account_token":"ACCOUNT-TOKEN-2","collection_token":"COLLECTION-TOKEN","token":"THING-TOKEN"}}',
                        'DEBUG - host status: OK',
                        'DEBUG - registration received'
                    ]);

                    context.should.eql({state: 'registered',config: {qiot_account_token: 'ACCOUNT-TOKEN-2'},qiot_collection_token: 'COLLECTION-TOKEN',qiot_thing_token: 'THING-TOKEN'});
                    host.httpHost.messageQueue.should.eql([{action: 'unspecified', version: 'unspecified', info: {}, stats: {}}]);
                });
            },done);
        });

        it('should report an error if no registration found',function(done){
            var host = new QiotMqttHost();

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
                    test.mockHTTPS.checkWritten(['{"identity":[{"type":"MAC","value":"00:00:00:00:00:00"}],"label":"MAC-00:00:00:00:00:00"}',null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST: {"identity":[{"type":"MAC","value":"00:00:00:00:00:00"}],"label":"MAC-00:00:00:00:00:00"}',
                        'DEBUG - host output: {}',
                        'DEBUG - host status: OK'
                    ]);
                    error.should.eql('no registration received');
                    host.httpHost.messageQueue.should.eql([{action: 'unspecified', version: 'unspecified', info: {}, stats: {}}]);
                });
            });
        });
    });

    describe('contact - message', function () {
        beforeEach(function(){
            context                             = {qiot_thing_token: 'THING-TOKEN'};
            config.settings.qiot_account_token  = new Buffer('ACCOUNT-NAME:ACCOUNT-SECRET').toString('base64');
        });

        it('should report that registration is NOT required',function(){
            var host = new QiotMqttHost();

            host.registrationRequired(context).should.be.not.ok;
        });

        it('should detect invalid credentials',function(done){
            var host = new QiotMqttHost();

            config.settings.qiot_account_token = 'INVALID-BASE64';

            host.contact(context).then(function(){ done('unexpected success')},function(error){
                test.asyncDone(done,function(){
                    test.mockMQTT.checkCalls();
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - start MQTT client'
                    ]);
                    error.should.eql('invalid credentials');
                    host.httpHost.messageQueue.should.eql([{action: 'unspecified', version: 'unspecified', info: {}, stats: {}}]);
                });
            });
        });

        it('should detect error creating MQTT client',function(done){
            var host = new QiotMqttHost();

            test.mockMQTT.connectError = 'test-error';

            host.contact(context).then(function(){ done('unexpected success')},function(error){
                test.asyncDone(done,function(){
                    test.mockMQTT.checkCalls();
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - start MQTT client',
                        'ERROR - connection error: test-error'
                    ]);
                    error.should.eql('test-error');
                    host.httpHost.messageQueue.should.eql([{action: 'unspecified', version: 'unspecified', info: {}, stats: {}}]);
                });
            });
        });

        it('should detect an MQTT publish error',function(done){
            var host = new QiotMqttHost();

            host.contact(context).then(function(){ done('unexpected success')},function(error){
                test.asyncDone(done,function(){
                    test.mockMQTT.checkCalls([[
                        'new:mqtt://api.qiot.io:{"clientId":"THING-TOKEN","username":"ACCOUNT-NAME","password":"ACCOUNT-SECRET","keepalive":60,"clean":true}',
                        'on:error',
                        'on:reconnect',
                        'on:close',
                        'on:offline',
                        'on:connect',
                        'on:message',
                        'publish:/1/l/THING-TOKEN:{"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}:{"qos":0,"retain":true}'
                    ]]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - start MQTT client',
                        'DEBUG - connected: {"ack":true}',
                        'DEBUG - publish: {"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}',
                        'ERROR - publish error: test-error'
                    ]);
                    error.should.eql('test-error');
                    host.httpHost.messageQueue.should.eql([{action: 'unspecified', version: 'unspecified', info: {}, stats: {}}]);
                });
            });

            test.mockMQTT.clients.length.should.eql(1);
            (!!test.mockMQTT.clients[0].topics['on:connect']).should.be.ok;
            test.mockMQTT.clients[0].topics['on:connect']({ack: true});

            _.defer(function(){
                test.asyncMidpoint(done,function(){
                    (!!test.mockMQTT.clients[0].topics['publish']).should.be.ok;
                    test.mockMQTT.clients[0].topics['publish']('test-error',null);
                })
            });
        });

        it('should create an MQTT client on first contact, then reuse it later, and finally trigger all event handlers for testing',function(done){
            var host = new QiotMqttHost();

            host.contact(context).then(function(context){
                host.contact(context).then(function(context){
                    test.asyncDone(done,function(){
                        (!!test.mockMQTT.clients[0].topics['on:error']).should.be.ok;
                        test.mockMQTT.clients[0].topics['on:error']('test-error');

                        (!!test.mockMQTT.clients[0].topics['on:reconnect']).should.be.ok;
                        test.mockMQTT.clients[0].topics['on:reconnect']();

                        (!!test.mockMQTT.clients[0].topics['on:close']).should.be.ok;
                        test.mockMQTT.clients[0].topics['on:close']();

                        (!!test.mockMQTT.clients[0].topics['on:offline']).should.be.ok;
                        test.mockMQTT.clients[0].topics['on:offline']();

                        (!!test.mockMQTT.clients[0].topics['on:message']).should.be.ok;
                        test.mockMQTT.clients[0].topics['on:message']('TEST-TOPIC','null');

                        test.mockMQTT.checkCalls([[
                            'new:mqtt://api.qiot.io:{"clientId":"THING-TOKEN","username":"ACCOUNT-NAME","password":"ACCOUNT-SECRET","keepalive":60,"clean":true}',
                            'on:error',
                            'on:reconnect',
                            'on:close',
                            'on:offline',
                            'on:connect',
                            'on:message',
                            'publish:/1/l/THING-TOKEN:{"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}:{"qos":0,"retain":true}',
                            'publish:/1/l/THING-TOKEN:{"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}:{"qos":0,"retain":true}'
                        ]]);
                        test.mockLogger.checkMockLogEntries([
                            'DEBUG - start MQTT client',
                            'DEBUG - connected: {"ack":true}',
                            'DEBUG - publish: {"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}',
                            'DEBUG - publish successful',
                            'DEBUG - publish: {"messages":[{"action":"unspecified","version":"unspecified","info":{},"stats":{}}]}',
                            'DEBUG - publish successful',
                            'ERROR - test-error',
                            'DEBUG - reconnected',
                            'DEBUG - closed',
                            'DEBUG - offline',
                            'DEBUG - message[TEST-TOPIC] = null'
                        ]);
                        context.should.eql({qiot_thing_token: 'THING-TOKEN'});
                        host.httpHost.messageQueue.should.eql([]);
                    });
                },done);

                _.defer(function(){
                    test.asyncMidpoint(done,function(){
                        (!!test.mockMQTT.clients[0].topics['publish']).should.be.ok;
                        test.mockMQTT.clients[0].topics['publish'](null,null);
                    })
                });

            },done);

            test.mockMQTT.clients.length.should.eql(1);
            (!!test.mockMQTT.clients[0].topics['on:connect']).should.be.ok;
            test.mockMQTT.clients[0].topics['on:connect']({ack: true});

            _.defer(function(){
                test.asyncMidpoint(done,function(){
                    (!!test.mockMQTT.clients[0].topics['publish']).should.be.ok;
                    test.mockMQTT.clients[0].topics['publish'](null,null);
                })
            });
        });
    });
});