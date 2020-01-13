const archiver = require('archiver');
const async = require('async');
const Authenticator = require('./lib/authenticator');
const configFile = require('./config');
const AutodeskForgeDesignAutomation = require('autodesk.forge.designautomation');
const FormData = require('form-data');
const fs = require('fs');
const handlebar = require('handlebars');
const logger = require('./lib/logger');
const path = require('path');
const retryUtils = require('./lib/retryUtils');
const _ = require('underscore');

const appBundleTemplateFileContent = fs.readFileSync('./templates/AppBundle.hbs', 'utf8');
const appBundleTemplate = handlebar.compile(appBundleTemplateFileContent);

const aliasTemplateFileContent = fs.readFileSync('./templates/Alias.hbs', 'utf8');
const aliasTemplate = handlebar.compile(aliasTemplateFileContent);

const pathToAppBundleZip = path.join(__dirname , 'appBundle/export.bundle.zip');
const pathToAppBundleFolder = path.join(__dirname , 'appBundle/export.bundle');

let config = {
    "retry" : {
        "maxNumberOfRetries" :  7,
        "backoffDelay" : 4000,
        "backoffPolicy" : "exponentialBackoffWithJitter"
    }
};
let DesignAutomationClient = new AutodeskForgeDesignAutomation.AutodeskForgeDesignAutomationClient(config);
let DesignAutomationApi = new AutodeskForgeDesignAutomation.AutodeskForgeDesignAutomationApi(DesignAutomationClient);

function zipAppBundleFolder(folderToZip, pathToZipFile, callback) {
    const output = fs.createWriteStream(pathToZipFile);
    output.on('close', function() {
        callback();
    });
    const archive = archiver('zip', {
        zlib: {level: 9}
    });
    archive.on('error', function(err) {
        callback(err);
    });
    archive.pipe(output);
    archive.directory(folderToZip, 'exportToFBX.bundle');
    archive.finalize();
}

function getErrorFromRequestResponse(err, resp, body) {
    return err || (resp.statusCode !== 200 ? "status code: " + resp.statusCode : null);
}

function uploadAppbundle(localPath, uploadParameters, callback) {
    const self = this;
    const form = new FormData();
    _.each(uploadParameters.formData, (element, index) => {
        form.append(index, element);
    });
    form.append('file', fs.readFileSync(localPath));
    retryUtils.exponentialBackoff(
        form.submit.bind(form),
        getErrorFromRequestResponse.bind(self),
        uploadParameters.endpointURL
    ) ((err, resp, body) => {
        callback(getErrorFromRequestResponse(err, resp, body));
    });
}

function createAppBundle() {
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
                oauth.accessToken = forgeOAuth2TwoLegged.getCredentials().access_token;
                next();
            });
        },
        function zipAppBundle(next) {
            logger.log('Zipping appBundle... ');
            zipAppBundleFolder(pathToAppBundleFolder, pathToAppBundleZip, next);
        },
        function deleteAppBundleIfExist(next) {
            logger.log('Deleting old appBundle if it already exist...');
            DesignAutomationApi.deleteAppBundle(configFile.designAutomation.appId).then(next, (error) => {
                next(error && error.status === 404 ? null : error);
            });
        },
        function createAppBundleVersion(next) {
            logger.log('Creating appBundle version 1...');
            let appBundleObjJson = appBundleTemplate({
                appId: configFile.designAutomation.appId,
                engineId: configFile.designAutomation.engineId
            });
            let appBundleObj = JSON.parse(appBundleObjJson);

            DesignAutomationApi.createAppBundle(appBundleObj).then((data) => {
                next(null, data.uploadParameters);
            }, next);
        },
        function uploadAppBundle(uploadParameters, next) {
            uploadAppbundle(pathToAppBundleZip, uploadParameters, next);
        },
        function createAppBundleAlias(next) {
            logger.log('Creating appBundle alias pointing to version 1...');
            let aliasObjJson = aliasTemplate({
                id: configFile.designAutomation.appAlias,
                version: 1
            });
            let aliasObj = JSON.parse(aliasObjJson);

            DesignAutomationApi.createAppBundleAlias(configFile.designAutomation.appId, aliasObj).then((data) => next(), next);
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
        logger.log('Finished creating appBundle');
        process.exit(0);
    });
}

createAppBundle();