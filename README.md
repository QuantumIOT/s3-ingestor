# S3-INGESTOR [![Build Status](https://travis-ci.org/QuantumIOT/s3-ingestor.svg?branch=master)](https://travis-ci.org/QuantumIOT/s3-ingestor)

This is a simple utility in NodeJS for pushing files from a local file system to S3 on an ongoing basis.

It assumes there is some "mothership" that can accept a periodic "phone home" event as an HTTP(S) request.
It will send the contents of `s3-ingestor-context.json` to the "mothership" and will receive a reply to store in the same place.

The each request to the "mothership" will include the following:

* **state**: This is the state the `s3-ingestor` thinks it is in -- generally it is whatever the "mothership" last sent in reply to a "phone home" event, but unless the "state" is set to "configured," the `s3-ingestor` will not upload any files.
* **version**: The version of the `s3-ingestor`.
* **info**: This contains information about the `s3-ingestor`. This will always contain "hostname" (which is currently expected to be unique), but will also contain the following on "startup." Simplistically, this will be the following information:
    * **hostname**:   os.hostname()
    * **hosttype**:   os.type()
    * **platform**:   os.platform()
    * **release**:    os.release()
    * **totalmem**:   os.totalmem()
    * **network**:    os.networkInterfaces()
* **action**: This tells the "mothership" what prompted the `s3-ingestor` to "phone home." These can be:
    * **startup**: Sent when the `s3-ingestor` is started.
    * **heartbeat**: Sent every "heartbeat_period" seconds as defined in the configuration.
    * **wakeup**: Sent if the `s3-ingestor` is asked to "wake up" (see below).
    * **upload**: Sent in response to an action replied by the "mothership" that results in files being uploaded.
    * **error**: Sent if an error occurs in response to an action replied by the "mothership"
    * If the mothership sends an "action" in reply to a "phone home" event, this action is echoed back unless an error occurs.
* **result**: This changes with each type of action, but generally, it is the status of files uploaded or considered for uploading:
    * **added**: New files uploaded.
    * **updated**: Existing files updated.
    * **skipped**: Files skipped because their file size matches what is already in S3.
    * **ignored**: Files not matching the policy to be uploaded.
    * **unchanged**: Files whose timestamp is the same as the last time it was considered.

The `s3-ingestor` has a set of default configuration options, but any of these can be overridden in a `s3-ingestor.json` configuration file:

* **debug**: Turns on/off debug logging (default: false)
* **api_port**: Port used for the "wakekup" HTTP service (default: 4567)
* **host_service**: Protocol used for contacting the "mothership" (default: 'https')
* **host_dns**: DNS name of the "mothersip" -- this **must** be provided
* **host_uri**: The URI where the "mothership" expects to receive "phone home" events (default: '/ingestor')
* **host_port**: The port on which the "mothership" is listening (default: 443)
* **heartbeat_period**: The frequency in seconds of "hearbeat" events (default: 3600)
* **aws_keys_file**: Where AWS keys are kept and expected to be provided by the "mothership" (default: 's3-ingestor-keys.json')
* **s3_bucket**: Where S3 files will be put -- this **must** be provided and expected to be provided by the "mothership"
* **upgrade_command**: The command used to upgrade itself when receiving an "upgrade" action from the "mothership" (default: 'npm update s3-ingestor')
* **policies**: An array of policy JSON objects used for deciding what to upload to S3 (default: a single policy object with all defaults)

Policy JSON objects used for uploading files from specific locations with the local file system include the following fields:

* **input_file_pattern**: The local file system pattern for files to consider (default: '**/*')
* **input_remove_prefix**: The prefix of the local file system filename to trunctate when making an S3 key (default: none)
* **output_key_prefix**: The prefix to add when creating an S3 key (default: none)
* **customizer**: The name of a Javascript file (minus the '.js') used to find a function to which to pass a filename to construct an key -- if this function returns a "falsey" value, the file will be ignored.

If the mothership sends "aws_keys" in the response, the contents will be stored in `s3-ingestor-keys.json`.
 
If the mothership sends "config" in the response, the config will be updated with whatever is included.

The "mothership" current can send the following "actions" to be performed by `s3-ingestor`:

* **customizers**: New contents for the `customizers` directory will be pulled from the **s3_bucket** at S3 key prefix "code/s3-ingestor/customizers/".
* **report**: The current configuration will be sent as the "result" to the "mothership".
* **upgrade**: The s3-ingestor NPM package will be updated.

The `s3-ingestor` is designed to be monitored by PM2 (https://github.com/Unitech/pm2) or something similar.
For example, if the "mothership" sends the **upgrade** action, `s3-ingestor` will upgrade itself and then terminate the process, assuming that PM2 will restart it.

The `s3-ingestor` has been tested to work on Windows.
To run on Windows as a service, consider https://github.com/jon-hall/pm2-windows-service
To install nodeJS on Windows, consider https://nodejs.org/en/download/