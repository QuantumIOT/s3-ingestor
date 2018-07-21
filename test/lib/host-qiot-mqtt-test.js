var _ = require('lodash');
var events = require('events');
var test = require('../test');

var os = require('os');

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
                    test.mockHTTPS.events.data(JSON.stringify({thing: {account_token: 'ACCOUNT-TOKEN-2',collection_token: 'COLLECTION-TOKEN',thing_token: 'THING-TOKEN'}}));
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
                        'DEBUG - host output: {"thing":{"account_token":"ACCOUNT-TOKEN-2","collection_token":"COLLECTION-TOKEN","thing_token":"THING-TOKEN"}}',
                        'DEBUG - host status: OK',
                        'DEBUG - registration received'
                    ]);

                    context.should.eql({state: 'registered',qiot_collection_token: 'COLLECTION-TOKEN',qiot_thing_token: 'THING-TOKEN'});
                    host.httpHost.messageQueue.should.eql([{
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
                    test.mockHTTPS.checkWritten(['{"identity":[{"type":"HOSTNAME","value":"TESTHOST"}],"label":"HOSTNAME-TESTHOST"}',null]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - host POST /1/r: {"identity":[{"type":"HOSTNAME","value":"TESTHOST"}],"label":"HOSTNAME-TESTHOST"}',
                        'DEBUG - host output: {}',
                        'DEBUG - host status: OK'
                    ]);
                    error.should.eql('no registration received');
                    host.httpHost.messageQueue.should.eql([{
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
                    host.httpHost.messageQueue.should.eql([{
                        state:      'unspecified',
                        state_id:   -1,
                        action:     'unspecified',
                        action_id:  -1,
                        version:    'unspecified'
                    }]);
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
                    host.httpHost.messageQueue.should.eql([{
                        state:      'unspecified',
                        state_id:   -1,
                        action:     'unspecified',
                        action_id:  -1,
                        version:    'unspecified'
                    }]);
                });
            });
        });

        it('should detect an MQTT publish error',function(done){
            var host = new QiotMqttHost();

            host.contact(context).then(function(){ done('unexpected success')},function(error){
                test.asyncDone(done,function(){
                    test.mockMQTT.checkCalls([[
                        'new:{"host":"api.qiot.io","port":1883,"clientId":"THING-TOKEN","username":"ACCOUNT-NAME","password":"ACCOUNT-SECRET","keepalive":60,"clean":true}',
                        'on:error',
                        'on:reconnect',
                        'on:close',
                        'on:offline',
                        'subscribe:1/m/THING-TOKEN:{"qos":0}',
                        'on:connect',
                        'on:message',
                        'publish:/1/l/THING-TOKEN:{"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}:{"qos":0,"retain":true}'
                    ]]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - start MQTT client',
                        'DEBUG - connected: {"ack":true}',
                        'DEBUG - publish: {"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}',
                        'ERROR - publish error: test-error'
                    ]);
                    error.should.eql('test-error');
                    host.httpHost.messageQueue.should.eql([{
                        state:      'unspecified',
                        state_id:   -1,
                        action:     'unspecified',
                        action_id:  -1,
                        version:    'unspecified'
                    }]);
                });
            });

            test.mockMQTT.clients.length.should.eql(1);
            (!!test.mockMQTT.clients[0].topics['on:connect']).should.be.ok;
            test.mockMQTT.clients[0].topics['on:connect']({ack: true});

            _.defer(function(){
                test.asyncMidpoint(done,function(){
                    (!!test.mockMQTT.clients[0].topics.publish).should.be.ok;
                    test.mockMQTT.clients[0].topics.publish('test-error',null);
                })
            });
        });

        it('should trigger a phonehome-wakeup event if its mailbox topic receives a message',function(done){
            var emitter = new events.EventEmitter();
            var host = new QiotMqttHost(emitter);

            emitter.on('phonehome',function(action){
                test.asyncDone(done,function(){
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - topic skipped: UNKOWN-TOPIC',
                        'DEBUG - mailbox message: {"mailbox":"test"}'
                    ]);
                    action.should.eql('wakeup');
                    host.mailboxMessage.should.eql({mailbox: 'test'});
                });
            });

            host.ensureConnection(context).then(function(){
                test.asyncMidpoint(done,function(){
                    test.mockMQTT.checkCalls([[
                        'new:{"host":"api.qiot.io","port":1883,"clientId":"THING-TOKEN","username":"ACCOUNT-NAME","password":"ACCOUNT-SECRET","keepalive":60,"clean":true}',
                        'on:error',
                        'on:reconnect',
                        'on:close',
                        'on:offline',
                        'subscribe:1/m/THING-TOKEN:{"qos":0}',
                        'on:connect',
                        'on:message'
                    ]]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - start MQTT client',
                        'DEBUG - connected: {"ack":true}'
                    ]);
                    (!!test.mockMQTT.clients[0].topics['on:message']).should.be.ok;
                    test.mockMQTT.clients[0].topics['on:message']('UNKOWN-TOPIC','null');
                    test.mockMQTT.clients[0].topics['on:message']('1/m/THING-TOKEN','{"mailbox":"test"}');
                })
            },done);

            test.mockMQTT.clients.length.should.eql(1);
            (!!test.mockMQTT.clients[0].topics['on:connect']).should.be.ok;
            test.mockMQTT.clients[0].topics['on:connect']({ack: true});
        });

        it('should update the current context with a mailbox message if it exists',function(done){
            var host = new QiotMqttHost();

            host.mailboxMessage = {id: 1,payload: JSON.stringify({test: 'TEST'})};

            host.contact(context).then(function(context){
                test.asyncDone(done,function(){
                    test.mockMQTT.checkCalls([[
                        'new:{"host":"api.qiot.io","port":1883,"clientId":"THING-TOKEN","username":"ACCOUNT-NAME","password":"ACCOUNT-SECRET","keepalive":60,"clean":true}',
                        'on:error',
                        'on:reconnect',
                        'on:close',
                        'on:offline',
                        'subscribe:1/m/THING-TOKEN:{"qos":0}',
                        'on:connect',
                        'on:message',
                        'publish:/1/l/THING-TOKEN:{"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}:{"qos":0,"retain":true}'
                    ]]);
                    test.mockLogger.checkMockLogEntries([
                        'DEBUG - start MQTT client',
                        'DEBUG - connected: {"ack":true}',
                        'DEBUG - publish: {"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}',
                        'DEBUG - publish successful',
                        'DEBUG - mailbox delivery: {"id":1,"payload":"{\\"test\\":\\"TEST\\"}"}',
                        'DEBUG - host POST /1/a/THING-TOKEN: {"status":"success","command_id":1}',
                        'DEBUG - host status: OK'
                    ]);
                    context.should.eql({qiot_thing_token: 'THING-TOKEN',test: 'TEST',last_mailbox_id: 1});
                    host.httpHost.messageQueue.should.eql([]);
                });
            },done);

            test.mockMQTT.clients.length.should.eql(1);
            (!!test.mockMQTT.clients[0].topics['on:connect']).should.be.ok;
            test.mockMQTT.clients[0].topics['on:connect']({ack: true});

            _.defer(function(){
                test.asyncMidpoint(done,function(){
                    (!!test.mockMQTT.clients[0].topics.publish).should.be.ok;
                    test.mockMQTT.clients[0].topics.publish(null,null);
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

                        (!!test.mockMQTT.clients[0].topics.subscribe).should.be.ok;
                        test.mockMQTT.clients[0].topics.subscribe(null,[{topic:'1/m/THING-TOKEN',qos:0}]);

                        test.mockMQTT.checkCalls([[
                            'new:{"host":"api.qiot.io","port":1883,"clientId":"THING-TOKEN","username":"ACCOUNT-NAME","password":"ACCOUNT-SECRET","keepalive":60,"clean":true}',
                            'on:error',
                            'on:reconnect',
                            'on:close',
                            'on:offline',
                            'subscribe:1/m/THING-TOKEN:{"qos":0}',
                            'on:connect',
                            'on:message',
                            'publish:/1/l/THING-TOKEN:{"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}:{"qos":0,"retain":true}',
                            'publish:/1/l/THING-TOKEN:{"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}:{"qos":0,"retain":true}'
                        ]]);
                        test.mockLogger.checkMockLogEntries([
                            'DEBUG - start MQTT client',
                            'DEBUG - connected: {"ack":true}',
                            'DEBUG - publish: {"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}',
                            'DEBUG - publish successful',
                            'DEBUG - publish: {"messages":[{"state":"unspecified","action":"unspecified","version":"unspecified","action_id":-1,"state_id":-1}]}',
                            'DEBUG - publish successful',
                            'ERROR - mqtt error: test-error',
                            'DEBUG - reconnected',
                            'DEBUG - closed',
                            'DEBUG - offline',
                            'DEBUG - subscribe: null:[{"topic":"1/m/THING-TOKEN","qos":0}]'
                        ]);
                        context.should.eql({qiot_thing_token: 'THING-TOKEN'});
                        host.httpHost.messageQueue.should.eql([]);
                    });
                },done);

                _.defer(function(){
                    test.asyncMidpoint(done,function(){
                        (!!test.mockMQTT.clients[0].topics.publish).should.be.ok;
                        test.mockMQTT.clients[0].topics.publish(null,null);
                    })
                });

            },done);

            test.mockMQTT.clients.length.should.eql(1);
            (!!test.mockMQTT.clients[0].topics['on:connect']).should.be.ok;
            test.mockMQTT.clients[0].topics['on:connect']({ack: true});

            _.defer(function(){
                test.asyncMidpoint(done,function(){
                    (!!test.mockMQTT.clients[0].topics.publish).should.be.ok;
                    test.mockMQTT.clients[0].topics.publish(null,null);
                })
            });
        });

    });
});