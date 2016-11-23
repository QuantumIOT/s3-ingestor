function QiotHost(){
    var self = this;

    // NOTE - delay loading for testability
    self.config = require('./config');
    self.logger = require('./logger');

    self.hostService = require(self.config.settings.host_service);
}

QiotHost.prototype.contact = function(context){
    var self = this;

    var contextJSON = JSON.stringify({context: context});
    var options = {
        host : self.config.settings.host_dns,
        port : self.config.settings.host_port,
        path : self.config.settings.host_uri,
        method : 'POST',
        headers : {
            'Content-Type' : 'application/json',
            'Content-Length' : Buffer.byteLength(contextJSON,'utf8')
        }
    };
    return new Promise(function(resolve,reject){
        self.logger.debug(function() { return 'host input: ' + contextJSON; });
        var request = self.hostService.request(options,function(response){
            response.on('data',function(data){
                self.logger.debug(function() { return 'host output: ' + data.toString() });
                try {
                    resolve(JSON.parse(data.toString()));
                } catch(error) {
                    self.logger.error(error);
                    reject('host output error - ' + error);
                }
            });
        });
        request.on('error',reject);
        request.write(contextJSON);
        request.end();
    });
};

module.exports = QiotHost;
