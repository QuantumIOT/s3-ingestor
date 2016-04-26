var logger = {debugging: false};

logger.message = function(message){
    console.log(new Date().toISOString() + ': ' + message);
};

logger.error = function(error) {
    logger.message('ERROR - ' + error)
};

logger.debug = function(debug){
    logger.debugging && logger.message('DEBUG - ' + (typeof debug == 'function' ? debug() : debug));
};

module.exports = logger;