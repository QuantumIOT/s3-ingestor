var logger = {debugging: false};

// istanbul ignore next
logger.message = function(message){
    console.log(message);
};

// istanbul ignore next
logger.error = function(error) {
    logger.message('ERROR - ' + error)
};

// istanbul ignore next
logger.debug = function(debug){
        logger.debugging && logger.message('DEBUG - ' + (typeof debug == 'function' ? debug() : debug));
};

module.exports = logger;