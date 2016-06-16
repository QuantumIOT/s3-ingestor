var fs = require('fs');
var process = require('process');

function PolicyBase(){
}

PolicyBase.prototype.buildKey = function(settings,filename){
    var self = this;

    var suffix = self.helpers.trimPrefix(filename,settings.input_remove_prefix || '');

    if (typeof(settings.customizer) === 'string') {
        var customizerPath = process.cwd() + '/customizers/' + settings.customizer;
        if (fs.existsSync(customizerPath + '.js')) settings.customizer = require(customizerPath);
    }
    
    if (typeof(settings.customizer) === 'function')
        suffix = settings.customizer(suffix,settings);
    else if (settings.customizer)
        suffix = null;

    return suffix ? (settings.output_key_prefix || '') + suffix : null;
};

module.exports = PolicyBase;