var test = require('../test');

var helpers = require(process.cwd() + '/lib/logger');

describe('helpers',function() {

    var debugging,timestamp,consoleLOG,output;

    beforeEach(function(){
        debugging = helpers.debugging;
        timestamp = helpers.timestamp;
        consoleLOG = helpers.consoleLOG;

        output = [];
        helpers.consoleLOG = function(string){ output.push(string); };
    });

    afterEach(function(){
        helpers.debugging = debugging;
        helpers.timestamp = timestamp;
        helpers.consoleLOG = consoleLOG;
    });

    describe('message',function(){
        it('should include a timestamp when true',function(){
            helpers.message('test');
            output.should.match(/\d\d\d\d-\d\d-\d\dT\d\d:\d\d\:\d\d.\d\d\dZ - test/)
        });

        it('should NOT include a timestamp when false',function(){
            helpers.timestamp = false;
            helpers.message('test');
            output.should.eql(['test'])
        })
    });

    describe('error',function(){
        it('should include a timestamp when true',function(){
            helpers.error('test');
            output.should.match(/\d\d\d\d-\d\d-\d\dT\d\d:\d\d\:\d\d.\d\d\dZ - ERROR - test/)
        });

        it('should NOT include a timestamp when false',function(){
            helpers.timestamp = false;
            helpers.error('test');
            output.should.eql(['ERROR - test'])
        })
    });

    describe('debug',function(){
        it('should do nothing by default',function(){
            helpers.debug('test');
            output.should.eql([]);
        });

        it('should include a timestamp when true and debugging true',function(){
            helpers.debugging = true;
            helpers.debug('test');
            output.should.match(/\d\d\d\d-\d\d-\d\dT\d\d:\d\d\:\d\d.\d\d\dZ - DEBUG - test/)
        });

        it('should NOT include a timestamp when false and debugging true',function(){
            helpers.debugging = true;
            helpers.timestamp = false;
            helpers.debug('test');
            output.should.eql(['DEBUG - test'])
        });

        it('should allow passing a function to evaluate to message',function(){
            helpers.debugging = true;
            helpers.timestamp = false;
            helpers.debug(function(){return 'test';});
            output.should.eql(['DEBUG - test'])
        })
    })

});