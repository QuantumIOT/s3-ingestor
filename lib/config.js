var _ = require('lodash');

var helpers = null;
var logger = null;

var config = {};

config.fileSettings = function(){ return helpers.readJSON(config.config_file,{},{}); };

config.reset = function(){

    config.home_full_path   = helpers.processENV.S3_INGESTOR_HOME ||  helpers.processCWD();
    config.config_file      = config.home_full_path + '/s3-ingestor.json';

    config.defaults = {
        debug:                  false,
        api_port:               4567,
        host_handler:           'host-basic',
        host_service:           'https',

        // NOTE - default decided by host handler
        // host_dns:               'unknown-host-dns'
        // host_port:              443,

        host_uri:               '/ingestor',
        heartbeat_period:       60*60,
        aws_keys_file:          config.home_full_path + '/s3-ingestor-keys.json',
        customizers_path:       config.home_full_path + '/customizers/',
        iam_reset_period:       20,
        s3_timeout:             5 * 60 * 1000,
        s3_bucket:              'unknown-s3-bucket',
        s3_customizers_prefix:  'code/s3-ingestor/customizers/',
        default_policy_handler: 'upload',
        target_directory:       'downloads',
        upgrade_command:        'npm update s3-ingestor',
        reboot_command:         'echo reboot', // NOTE: this must be overridden
        policies: [
            // NOTE - below are the known policy fields, but 0 policies are defined by default
            // {
            //     handler: undefined,
            //     input_file_pattern: undefined,
            //     input_remove_prefix: undefined,
            //     output_key_prefix: undefined,
            //     customizer: undefined
            // }
        ]
    };

    var fileSettings = config.fileSettings();
    var policies = fileSettings.policies;
    delete fileSettings.policies;

    config.settings = _.extend({},config.defaults,fileSettings);
    if (policies) config.settings.policies = policies;

    logger.debugging = config.settings.debug;
};

config.update = function(newSettings){

    var fileSettings = config.fileSettings();
    _.each(newSettings,function(value,key){
        if (fileSettings[key] !== value)
            if (config.defaults[key] === value)
                delete fileSettings[key];
            else
                fileSettings[key] = value;
    });

    logger.message('config updated');
    logger.debug(function(){return JSON.stringify(fileSettings)});

    helpers.saveJSON(config.config_file,fileSettings);
    config.reset();
};

config.copySettings = function(extra){
    return _.extend({},config.settings,extra || {})
};

config.resetLoggerAndHelpers = function(){
    logger = require('./logger');
    helpers = require('./helpers');
};

config.resetLoggerAndHelpers();

config.reset();

module.exports = config;