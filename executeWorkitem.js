const async = require('async');
const AutodeskForgeDesignAutomation = require('autodesk.forge.designautomation');
const Authenticator = require('./lib/authenticator');
const configFile = require('./config');
const DownloadQueue = require('./lib/downloadQueue');
const fs = require('fs');
const handlebar = require('handlebars');
const logger = require('./lib/logger');
const storageUtils = require('./lib/storageUtils');
const UploadQueue = require('./lib/uploadQueue');
const uuidv4 = require('uuid/v4');



const workitemTemplateFileContent = fs.readFileSync('./templates/Workitem.hbs', 'utf8');
const workitemTemplate = handlebar.compile(workitemTemplateFileContent);

let config = {
    "retry" : {
        "maxNumberOfRetries" :  7,
        "backoffDelay" : 4000,
        "backoffPolicy" : "exponentialBackoffWithJitter"
    }
};
let DesignAutomationClient = new AutodeskForgeDesignAutomation.AutodeskForgeDesignAutomationClient(config);
let DesignAutomationApi = new AutodeskForgeDesignAutomation.AutodeskForgeDesignAutomationApi(DesignAutomationClient);

const inputStoragePrefix = 'input-';
const outputStoragePrefix = 'output-';

function initializeStorage(jobId, forgeOAuth2TwoLegged, callback) {
    logger.log('Creating OSS bucket if it does not exist...');
    storageUtils.createBucketIfDoesNotExist(
        forgeOAuth2TwoLegged,
        (err, bucketDetails) => {
            if (err && err.statusCode === 403) {
                logger.log('Error creating the OSS bucket.  This is most likely because the name you chose for the bucket is already used by someone else. Change ossBucketName in the config file and try again');
                process.exit(1);
            }
            if (err && err.statusCode === 400) {
                logger.log('Error creating the OSS bucket.  This is most likely because the name you chose for the bucket contains illegal characters. Make sure ossBucketName in the config file is of that form [-_.a-z0-9]{3,128} ');
                process.exit(1);
            }
            callback(err);
        }
    );
}

function waitForWorkItemToComplete(accessToken, workItemId, callback) {
    const startWait = new Date();
    let workitemStatus;
    async.doWhilst(
        function checkForCompletionStatus(next) {
            setTimeout(() => {
                DesignAutomationApi.getWorkitemStatus(workItemId).then((data) => {
                    workitemStatus = data;
                    next();
                }, next);
            }, configFile.timeBetweenPolls);
        },
        function checkWorkItemStatusComplete() {
            logger.log('Checking status: ' + workitemStatus.status + ' ' + (Date.now() - startWait) + ' ms');
            return workitemStatus.status === 'pending' || workitemStatus.status === 'inprogress';
        },
        () => {
            if (workitemStatus.reportUrl) {
                logger.log('Log file available here: ' + workitemStatus.reportUrl)
            }

            if (workitemStatus.status !== 'success') {
                callback('Workitem finished with status: ' + workitemStatus.status);
                return;
            }
            callback();
        }
    );
}

function executeWorkitem() {
    let nickname;
    let oAuth2TwoLegged;
    const jobId = uuidv4();
    let downloadQueue = new DownloadQueue();
    let uploadQueue = new UploadQueue();
    async.waterfall([
        function getAccessToken(next)
        {
            logger.log('Getting Access Token...');
            const authenticator = new Authenticator(configFile.forge.clientId, configFile.forge.clientSecret);
            authenticator.getForgeOAuth2TwoLeggedObject((error, forgeOAuth2TwoLegged) => {
                if (error)
                {
                    next(error);
                    return;
                }
                let oauth = DesignAutomationClient.authManager.authentications['2-legged'];
                oAuth2TwoLegged = forgeOAuth2TwoLegged;
                oauth.accessToken = oAuth2TwoLegged.getCredentials().access_token;
                next();
            });
        },
        function getNickname(next) {
            logger.log('Getting Nickname...');
            DesignAutomationApi.getNickname("me").then((data) => {
                nickname = data;
                next();
            }, next);
        },
        function initializeOSSStorage(next) {
            logger.log('Initializing storage...');
            initializeStorage(jobId, oAuth2TwoLegged, next);
        },
        function getInputUploadUrl(next) {
            logger.log('Generating input upload url');
            storageUtils.getSignedUrl(oAuth2TwoLegged, inputStoragePrefix + jobId, 'write', next);
        },
        function queueUploads(uploadUrl, next)
        {
            logger.log('Queueing upload...');
            uploadQueue.queue(uploadUrl, process.argv[2]);
            next();
        },
        function waitForUploadsToFinish(next)
        {
            logger.log('Waiting for uploads to finish...');
            uploadQueue.waitForQueueToBeProcessed(next);
        },
        function getPresignedUrlsForWorkitem(next)
        {
            logger.log('Generating signed urls for workitem submission...');
            async.parallel([
                function getInputPresignedUrl(next)
                {
                    storageUtils.getSignedUrl(oAuth2TwoLegged, inputStoragePrefix + jobId, 'read', next)
                },
                function getOutputPresignedUrl(next)
                {
                    storageUtils.getSignedUrl(oAuth2TwoLegged, outputStoragePrefix + jobId, 'write', next);
                }
            ], (error, results) => {
                if (error)
                {
                    next(error);
                }
                next(null, results[0], results[1]);
            });
        },
        function createWorkitem(presignedInputUrl, presignedOutputUrl, next)
        {
            logger.log('Submitting workitem...');
            const workitemObjectJson = workitemTemplate({
                activityId: nickname + '.' + configFile.designAutomation.activityId + '+' + configFile.designAutomation.activityAlias,
                inputUrl: presignedInputUrl,
                outputUrl: presignedOutputUrl
            });
            const workitemObject = JSON.parse(workitemObjectJson);

            DesignAutomationApi.createWorkItem(workitemObject).then((data) => {
                next(null, data.id)
            }, next);
        },
        function waitForWorkitemToComplete(workitemId, next)
        {
            logger.log('waiting for workitem ' + workitemId + ' to complete...');
            waitForWorkItemToComplete(oAuth2TwoLegged.getCredentials().access_token, workitemId, next)
        },
        function getPresignedDownloadOutputUrl(next)
        {
            storageUtils.getSignedUrl(oAuth2TwoLegged, outputStoragePrefix + jobId, 'read', next);
        },
        function queueDownload(signedOutputUrl, next)
        {
            logger.log('Queueing downloads...');
            downloadQueue.queue(signedOutputUrl, jobId);
            next();
        },
        function waitForDownloadToFinish(next)
        {
            logger.log('Waiting for downloads to finish...');
            downloadQueue.waitForQueueToBeProcessed(next);
        }
    ], function (err) {
        if (err) {
            logger.log(err);
            if (err && err.status)
            {
                logger.log('Status: ' + err.status);
            }
            if (err && err.response && err.response.text)
            {
                logger.log('Text: ' + err.response.text);
            }
            process.exit(-1);
        }
        logger.log('Finished executing workitem');
        process.exit(0);
    });
}

executeWorkitem();