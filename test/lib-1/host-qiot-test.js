var test = require('../test');

var QiotHost = require(process.cwd() + '/lib/host-qiot');

describe('PhoneHome',function() {

    var config;

    beforeEach(function () {
        test.mockery.enable();
        test.mockery.warnOnReplace(false);
        test.mockery.registerAllowables(['lodash','./config','./logger',test.configGuard.requirePath]);
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
        test.mockLogger.debugging = false;

        test.configGuard.finishGuarding();
        test.mockHelpers.checkMockFiles();
        test.mockLogger.checkMockLogEntries();
        test.mockery.deregisterAll();
        test.mockery.disable();
    });

    describe('findIdentity',function(){
        it('should find the external mac addresses in the os as identity values',function(){
            test.mockHelpers.networkInterfaces = function (){ return {
                lo0: [
                    {
                        address: '::1',
                        netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
                        family: 'IPv6',
                        mac: '00:00:00:00:00:00',
                        scopeid: 0,
                        internal: true
                    },
                    {
                        address: '127.0.0.1',
                        netmask: '255.0.0.0',
                        family: 'IPv4',
                        mac: '00:00:00:00:00:00',
                        internal: true
                    },
                    {
                        address: 'fe80::1',
                        netmask: 'ffff:ffff:ffff:ffff::',
                        family: 'IPv6',
                        mac: '00:00:00:00:00:00',
                        scopeid: 1,
                        internal: true
                    }
                 ],
                en0: [
                    {
                        address: 'fe80::a299:9bff:fe05:daa3',
                        netmask: 'ffff:ffff:ffff:ffff::',
                        family: 'IPv6',
                        mac: 'a0:99:9b:05:da:a3',
                        scopeid: 4,
                        internal: false
                    },
                    {
                        address: '192.168.1.7',
                        netmask: '255.255.255.0',
                        family: 'IPv4',
                        mac: 'a0:99:9b:05:da:a3',
                        internal: false
                    }
                ],
                awdl0: [
                    {
                        address: 'fe80::f4a5:52ff:fe2f:a44e',
                        netmask: 'ffff:ffff:ffff:ffff::',
                        family: 'IPv6',
                        mac: 'f6:a5:52:2f:a4:4e',
                        scopeid: 8,
                        internal: false
                    }
                ],
                en4: [
                    {
                        address: 'fe80::426c:8fff:fe46:79fb',
                        netmask: 'ffff:ffff:ffff:ffff::',
                        family: 'IPv6',
                        mac: '40:6c:8f:46:79:fb',
                        scopeid: 9,
                        internal: false
                    },
                    {
                        address: '192.168.1.12',
                        netmask: '255.255.255.0',
                        family: 'IPv4',
                        mac: '40:6c:8f:46:79:fb',
                        internal: false
                    }
                ]
            };};

            var host = new QiotHost();
            host.findIdentity().should.eql([
                { type: 'MAC', value: 'a0:99:9b:05:da:a3' },
                { type: 'MAC', value: 'f6:a5:52:2f:a4:4e' },
                { type: 'MAC', value: '40:6c:8f:46:79:fb' }
            ]);
        });
    });

    describe('contact - register', function (done) {
        it('should perform a registration if no qiot_account_token exists in the config',function(){
            var host = new QiotHost();

            test.mockHTTPS.deferAfterEnd = function(){
                (!!test.mockHTTPS.events.data).should.be.ok;
                test.mockHTTPS.events.data(JSON.stringify({thing: {account_token: 'ACCOUNT-TOKEN',collection_token: 'COLLECTION-TOKEN',token: 'THING-TOKEN'}}));
            };

            host.contact({}).then(function(context){
                test.mockLogger.checkMockLogEntries([
                    'DEBUG - host input: {"identity":[{"type":"MAC","value":"a0:99:9b:05:da:a3"},{"type":"MAC","value":"f6:a5:52:2f:a4:4e"},{"type":"MAC","value":"40:6c:8f:46:79:fb"}],"label":"MAC-a0:99:9b:05:da:a3"}',
                    'DEBUG - host output: {"thing":{"account_token":"ACCOUNT-TOKEN","collection_token":"COLLECTION-TOKEN","token":"THING-TOKEN"}}',
                    'DEBUG - registration received'
                ]);
                test.mockHTTPS.checkWritten(['{"identity":[{"type":"MAC","value":"a0:99:9b:05:da:a3"},{"type":"MAC","value":"f6:a5:52:2f:a4:4e"},{"type":"MAC","value":"40:6c:8f:46:79:fb"}],"label":"MAC-a0:99:9b:05:da:a3"}',null]);

                context.should.eventually.equal({qiot_account_token: 'ACCOUNT-TOKEN',qiot_collection_token: 'COLLECTION-TOKEN',qiot_thing_token: 'THING-token'});

                done();
            },function(){ true.should.not.be.ok; done(); });
        });
    });

    describe('contact - message', function () {
        it('should send a status message when a  qiot_account_token exists in the config',function(){

        });
    });
});