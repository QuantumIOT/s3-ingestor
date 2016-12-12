var fs = require('fs');
var test = require('../test');

var helperPath = process.cwd() + '/lib/helpers';

describe('helpers',function(){
    var helpers = null;

    beforeEach(function () {
        var basicHandlerPath = process.cwd() + '/lib/host-basic';
        var qiotHandlerPath = process.cwd() + '/lib/host-qiot-http';
        test.mockery.enable();
        test.mockery.registerAllowables(['https','lodash','./config','./helpers',helperPath,basicHandlerPath,qiotHandlerPath]);
        test.mockery.warnOnReplace(false);
        test.mockery.registerMock('./logger',test.mockLogger);
        test.mockLogger.resetMock();

        helpers = require(helperPath);
        helpers.resetLogger();
    });

    afterEach(function () {
        test.mockLogger.checkMockLogEntries();
        test.mockery.disable();
    });

    describe('bestPort',function(){
        it('should choose 80 for http',function(){
            helpers.bestPort('http',8000).should.eql(80);
        });

        it('should choose 443 for https',function(){
            helpers.bestPort('https',8000).should.eql(443);
        });

        it('should choose passed-in default for unknown service',function(){
            helpers.bestPort('???',8000).should.eql(8000);
        })
    });

    describe('bestHost',function(){
        it('should return a BasicHost by default',function(){
            helpers.bestHost({}).should.be.ok;
            helpers.lastHostName.should.eql('host-basic');
        });

        it('should return a QiotHttpHost if settings has a qiot_account_token',function(){
            helpers.bestHost({qiot_account_token: 'ACCOUNT-TOKEN'}).should.be.ok;
            helpers.lastHostName.should.eql('host-qiot-http');
        });

        it('should return a QiotHttpHost if explicitly in the settings',function(){
            helpers.bestHost({host_handler: 'host-qiot-http'}).should.be.ok;
            helpers.lastHostName.should.eql('host-qiot-http');
        });
    });

    describe('readJSON',function(){
        it('should read a JSON file if it exists',function(){
            helpers.readJSON(process.cwd() + '/test/data/test.json',{result: 'default'},{result: 'error'}).should.eql({state: 'test'});
        });

        it('should return the default value if the file does not exist',function(){
            helpers.readJSON(process.cwd() + '/test/data/missing.json',{result: 'default'},{result: 'error'}).should.eql({result: 'default'});
        });

        it('should return the error value if the file is invalid',function(){
            helpers.readJSON(process.cwd() + '/test/data/invalid.json',{result: 'default'},{result: 'error'}).should.eql({result: 'error'});
            test.mockLogger.checkMockLogEntries(['ERROR - SyntaxError: Unexpected end of input']);
        });
    });

    describe('saveJSON',function(){
        it('should save a JSON object to a file',function(){
            fs.mkdir('tmp/',function(error) {
                var testFile = 'tmp/save-test.json';
                helpers.saveJSON(testFile,{success: true});
                fs.readFileSync(testFile).toString().should.eql('{"success":true}');
                fs.unlinkSync(testFile);
            });
        });

        it('should log an error if saving fails',function(){
            helpers.saveJSON(null,{success: true});
            test.mockLogger.checkMockLogEntries(['ERROR - save JSON error - TypeError: path must be a string']);
        })
    });

    describe('safeParseJSON',function(){
       it('should return valid parsed json',function(){
           helpers.safeParseJSON('{"test":1}').should.eql({test: 1});
       });

        it('should return null for invalid json',function(){
            (helpers.safeParseJSON('{') === null).should.be.ok;
            test.mockLogger.checkMockLogEntries(['ERROR - json error: SyntaxError: Unexpected end of input']);
        });
    });

    describe('fileExists',function(){
        it('should return stat object for file that exists',function(){
            (!!helpers.fileExists('test/test.js')).should.be.ok;
        });

        it('should return null for invalid json',function(){
            (!!helpers.fileExists('unknown.txt')).should.not.be.ok;
        });
    });

    describe('requireLIB',function(){
        it('should return null if a requested module does not exist',function(){
            (!!helpers.requireLIB('unknown')).should.not.be.ok;
        });

       it('should pass through a "require" request for /lib files with just the lib file name',function(){
           helpers.requireLIB('helpers').should.eql(helpers);
       });
    });
    
    describe('trimPrefix',function(){
        it('should return the string unchanged if the prefix is 0 length',function(){
            helpers.trimPrefix('string','').should.eql('string');
        });

        it('should return the string unchanged if the prefix does not match',function(){
            helpers.trimPrefix('string','x').should.eql('string');
        });

        it('should return the string without a matching prefix',function(){
            helpers.trimPrefix('string','s').should.eql('tring');
            helpers.trimPrefix('string','string').should.eql('');
        });
    });

    describe('isoTimestamp',function(){
        it('should return the current time as an ISO timestamp',function(){
            helpers.isoTimestamp().should.match(/^\d\d\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/)
        });
    })
});