function PolicyBase(){
}

PolicyBase.prototype.setupBase = function (){
    var self = this;

    self.helpers = require('./helpers');
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