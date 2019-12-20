const async = require('async');
const fs = require('fs');
const logger = require('./logger');
const request = require('request');

class UploadQueue
{
    constructor()
    {
        this._queue = async.queue(
            function uploadFile(task, callback) {
                request({
                    url: task.url,
                    method: 'PUT',
                    body: fs.readFileSync(task.filePath)
                }, callback);
            },
            7
        );

        this._queue.error((err) => {
            logger.log('ERROR UPLOADING INPUT: ' + err);
            process.exit(-1);
        });
    }

    queue(uploadUrl, localFilePath) {
        const self = this;
        self._queue.push(
            [
                {
                    "url": uploadUrl,
                    "filePath": localFilePath
                }
            ]
        );
    }

    waitForQueueToBeProcessed(callback)
    {
        if (this._queue.length() === 0 && !this._queue.running()) {
            callback();
            return;
        }
        logger.log('Waiting for uploads to finish ...');
        this._queue.drain = callback;
    }
}
module.exports = UploadQueue;