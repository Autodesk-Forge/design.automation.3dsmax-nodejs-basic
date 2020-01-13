const async = require('async');
const fs = require('fs');
const logger = require('./logger');
const mkdirp = require('mkdirp');
const path = require('path');
const request = require('request');

class DownloadQueue
{
    constructor()
    {
        this._queue = async.queue(
            function downloadFile(task, callback) {
                const dir = path.dirname(task.destination);
                mkdirp(dir, (err) => {
                    if (err) {
                        callback(err);
                        return;
                    }
                    request(task.url)
                        .pipe(fs.createWriteStream(task.destination))
                        .on('finish', () => {
                            callback();
                        });
                });
            },
            7
        );

        this._queue.error((err) => {
            logger.log('ERROR DOWNLOADING OUTPUT: ' + err);
            process.exit(-1);
        });
    }

    queue(downloadUrl, jobId) {
        this._queue.push(
            [
                {
                    "url": downloadUrl,
                    "destination": path.join(__dirname, '../Results', jobId + '.fbx' ).split('\\').join('/')
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
        logger.log('Waiting for downloads to finish ...');
        this._queue.drain = callback;
    }
}
module.exports = DownloadQueue;