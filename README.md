# S3-INGESTOR

This is a simple utility in NodeJS for pushging files from a local file system to S3 on an ongoing basis.

It assumes there is some "mothership" that can accept a periodic "phone home" event as an HTTP(S) request.
It will send the contents of `s3-ingestor-context.json` to the "mothership" and will receive a reply to store in the same place...

[MORE HERE]

The `s3-ingestor.js` has a set of default configuration options, but any of these can be overridden in a `s3-ingestor.json` configuration file...

[MORE HERE]

Credentials for uploading files to S3 are stored in `s3-ingestor-keys.json` and can (eventually) be provided by the "mothership"...

[MORE HERE]

Policies for uploading files from specific locations with the local file system can be added to `s3-ingestor.json`,
which includes the ability to provide a "customizer" function that allows a decision to be made about how to construct the key used to upload to S3;
the default is to use the local filename/path as part of the key...

[MORE HERE]

To run on Windows as a server, consider `https://github.com/jon-hall/pm2-windows-service`...