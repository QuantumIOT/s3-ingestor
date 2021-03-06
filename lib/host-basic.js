function BasicHost(emitter){
    var self = this;

    // NOTE - delay loading for testability
    self.config = require('./config');
    self.helpers = require('./helpers');
    self.logger = require('./logger');

    self.hostService = require(self.config.settings.host_service);
}

BasicHost.prototype.setWatchdogTimer = function(){};

BasicHost.prototype.registrationRequired = function(context){
    return false;
};

BasicHost.prototype.contact = function(context){
    var self = this;

    var contextJSON = JSON.stringify({context: context});
    var options = {
        host:   self.config.settings.host_dns || 'unknown-host-dns',
        port:   self.config.settings.host_port || self.helpers.bestPort(self.config.settings.host_service,8000),
        path:   self.config.settings.host_uri,
        method: 'POST',
        headers: {
            'Content-Type' : 'application/json',
            'Content-Length' : Buffer.byteLength(contextJSON,'utf8')
        }
    };
    return new Promise(function(resolve,reject){
        self.logger.debug(function() { return 'host POST: ' + contextJSON; });
        var request = self.hostService.request(options,function(response){
            response.on('data',function(data){
                try {
                    var dataString = data.toString();
                    self.logger.debug(function() { return 'host output: ' + dataString });

                    var json = self.helpers.safeParseJSON(dataString);

                    if (json)
                        resolve(json);
                    else
                        reject('no json received');
                } catch(error) {
                    reject(error);
                }
            });
        });
        request.on('error',reject);
        request.write(contextJSON);
        request.end();
    });
};

module.exports = BasicHost;
