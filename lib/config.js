var _ = require('lodash');

var helpers = require('./helpers');
var logger = require('./logger');

var CONFIG_FILE = 's3-ingestor.json';

var configDefaults = {
    debug: false,
    api_port: 4567,
    host_service: 'https',
    host_dns: 'unknown-host-dns',
    host_uri: '/ingestor',
    host_port: 443,
    heartbeat_period: 60*60,
    aws_keys_file: 's3-ingestor-keys.json',
    s3_bucket: 'unknown-s3-bucket',
    upgrade_command: 'npm update s3-ingestor',
    policies: [{
        input_file_pattern: undefined,
        input_remove_prefix: undefined,
        output_key_prefix: undefined,
        customizer: undefined
    }]
};

var config = {};

config.fileSettings = function(){ return helpers.readJSON(CONFIG_FILE,{},{}); };

config.reset = function(){
    var fileSettings = config.fileSettings();
    var policies = fileSettings.policies;
    delete fileSettings.policies;

    config.settings = _.merge(configDefaults,config.fileSettings());
    if (policies) config.settings.policies = policies;

    logger.debugging = config.settings.debug;
};

config.update = function(newSettings){

    var fileSettings = config.fileSettings();
    _.each(newSettings,function(value,key){
        if (fileSettings[key] !== value)
            if (configDefaults[key] === value)
                delete fileSettings[key];
            else
                fileSettings[key] = value;
    });
    helpers.saveJSON(CONFIG_FILE,fileSettings);
    config.reset();
};

config.reset();

module.exports = config;