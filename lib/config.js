var _ = require('lodash');

var helpers = require('./helpers');
var logger = require('./logger');

var CONFIG_FILE = 's3-ingestor.json';

var configDefaults = {
    debug: false,
    api_port: 4567,
    host_service: 'https',
    host_dns: 'unknown-host-dns',
    host_uri: '/master',
    host_port: 443,
    heartbeat_period: 60*60,
    aws_keys_file: 's3-ingestor-keys.json',
    s3_bucket: 'unknown-s3-bucket',
    policies: [{
        input_file_pattern: '**/*',
        input_remove_prefix: undefined,
        output_key_prefix: undefined,
        customizer: undefined
    }]
};

var config = _.merge(configDefaults,helpers.readJSON(CONFIG_FILE,{},{}));

logger.debugging = config.debug;

module.exports = config;