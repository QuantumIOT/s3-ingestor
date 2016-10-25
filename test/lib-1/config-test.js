var fs = require('fs');
var test = require('../test');

var configPath = process.cwd() + '/lib/config';

describe('config',function(){
    var config = null;

    beforeEach(function () {
        test.mockery.enable();
        test.mockery.registerAllowables([configPath,'lodash']);
        test.mockery.warnOnReplace(false);
        test.mockery.registerMock('./helpers', test.mockHelpers);
        test.mockery.registerMock('./logger',test.mockLogger);

        test.mockLogger.resetMock();
        test.mockHelpers.resetMock();

        config = require(configPath);
        config.resetLoggerAndHelpers();
        config.reset();

        test.mockLogger.resetMock();
        test.mockHelpers.resetMock();
    });

    afterEach(function () {
        test.mockHelpers.checkMockFiles();
        test.mockLogger.checkMockLogEntries();
        test.mockery.disable();
    });

    describe('reset',function(){
        it('should turn off debugging by default and reload the file',function(){
            test.mockLogger.debugging = true;
            test.mockLogger.debugging.should.be.ok;

            config.reset();
            test.mockLogger.debugging.should.not.be.ok;
            test.mockHelpers.checkMockFiles([['s3-ingestor.json','default']]);
        });

        it('should replace default policies from the config file',function(){
            test.mockHelpers.filesToRead['s3-ingestor.json'] = {policies: [{handler: 'test'}]};

            config.reset();
            test.mockHelpers.checkMockFiles([['s3-ingestor.json','success']]);
            config.settings.policies.should.eql([{handler: 'test'}]);
        })
    });

    describe('update',function(){
        it('should not save any default values in the config file',function(){
            config.update(config.settings);
            test.mockHelpers.checkMockFiles([['s3-ingestor.json','default'],['s3-ingestor.json','success']],[['s3-ingestor.json',{}]]);
            test.mockLogger.checkMockLogEntries(['config updated']);
        });

        it('should save any non-default values in the config file',function(){
            config.update({test: true});
            test.mockHelpers.checkMockFiles([['s3-ingestor.json','default'],['s3-ingestor.json','success']],[['s3-ingestor.json',{test: true}]]);
            test.mockLogger.checkMockLogEntries(['config updated']);
        });

        it('should keep save any existing values in the config file',function(){
            test.mockHelpers.filesToRead['s3-ingestor.json'] = {existing: 'test'};
            config.update({test: true});
            test.mockHelpers.checkMockFiles([['s3-ingestor.json','success'],['s3-ingestor.json','success']],[['s3-ingestor.json',{test: true,existing: 'test'}]]);
            test.mockLogger.checkMockLogEntries(['config updated']);
        });

        it('should save any changed values in the config file',function(){
            test.mockHelpers.filesToRead['s3-ingestor.json'] = {test: false};
            config.update({test: true});
            test.mockHelpers.checkMockFiles([['s3-ingestor.json','success'],['s3-ingestor.json','success']],[['s3-ingestor.json',{test: true}]]);
            test.mockLogger.checkMockLogEntries(['config updated']);
        });

        it('should replace any policies in the config file',function(){
            test.mockHelpers.filesToRead['s3-ingestor.json'] = {test: false,policies: ['old']};
            test.mockLogger.debugging = true;
            config.update({test: true,policies: ['new']});
            test.mockHelpers.checkMockFiles([['s3-ingestor.json','success'],['s3-ingestor.json','success']],[['s3-ingestor.json',{test: true,policies: ['new']}]]);
            test.mockLogger.checkMockLogEntries(['config updated','DEBUG - {"test":true,"policies":["new"]}']);
        });
    });
});