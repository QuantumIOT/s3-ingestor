var AWS = require('./aws');

function PolicyBase(){
}

PolicyBase.prototype.setupBase = function (){
    var self = this;

    // NOTE - delay loading for testability
    self.helpers = require('./helpers');
    self.logger  = require('./logger');
};

PolicyBase.prototype.setupApplyState = function(context,settings,resolve,reject){
    var self = this;

    if (!self.aws) self.aws = new AWS(settings);

    self.context  = context;
    self.settings = settings;
    self.resolve  = resolve;
    self.reject   = reject;
};

PolicyBase.prototype.recordError = function(err){
    var self = this;

    self.logger.error('policy error: ' + err);
    self.context.action = self.context.action ? self.context.action + '+error' : 'error';
    self.context.error = err;
    self.reject(err);
};

PolicyBase.prototype.ensureCustomizer = function(settings){
    var self = this;

    if (typeof(settings.customizer) === 'string') {
        var customizerPath = self.helpers.processCWD() + '/customizers/' + settings.customizer;
        if (self.helpers.fileExists(customizerPath + '.js')) settings.customizer = require(customizerPath);
    }

    return typeof(settings.customizer) === 'function';
};

PolicyBase.prototype.buildKey = function(settings,filename){
    var self = this;

    var suffix = self.helpers.trimPrefix(filename,settings.input_remove_prefix || '');

    if (self.ensureCustomizer(settings))
        suffix = settings.customizer(suffix,settings);
    else if (settings.customizer)
        suffix = null;

    return suffix ? (settings.output_key_prefix || '') + suffix : null;
};

module.exports = PolicyBase;