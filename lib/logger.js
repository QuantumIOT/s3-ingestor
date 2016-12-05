var logger = {debugging: false,timestamp: true,consoleLOG: console.log};

logger.message = function(message){
    if (logger.timestamp) message = (new Date().toISOString()) + ' - ' + message;
    logger.consoleLOG(message);
};

logger.error = function(error) {
    logger.message('ERROR - ' + error)
};

logger.debug = function(debug){
    logger.debugging && logger.message('DEBUG - ' + (typeof debug == 'function' ? debug() : debug));
};

module.exports = logger;