const async = require('async');
const Authenticator = require('./lib/authenticator');
const configFile = require('./config');
const AutodeskForgeDesignAutomation = require('autodesk.forge.designautomation');
const fs = require('fs');
const handlebar = require('handlebars');
const logger = require('./lib/logger');

const activityTemplateFileContent = fs.readFileSync('./templates/Activity.hbs', 'utf8');
const activityTemplate = handlebar.compile(activityTemplateFileContent);

const aliasTemplateFileContent = fs.readFileSync('./templates/Alias.hbs', 'utf8');
const aliasTemplate = handlebar.compile(aliasTemplateFileContent);

let config = {
    "retry" : {
        "maxNumberOfRetries" :  7,
        "backoffDelay" : 4000,
        "backoffPolicy" : "exponentialBackoffWithJitter"
    }
};
let DesignAutomationClient = new AutodeskForgeDesignAutomation.AutodeskForgeDesignAutomationClient(config);
let DesignAutomationApi = new AutodeskForgeDesignAutomation.AutodeskForgeDesignAutomationApi(DesignAutomationClient);

function createActivity() {
    let nickname;
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
        function getNickname(next) {
            logger.log('Getting Nickname...');
            DesignAutomationApi.getNickname("me").then((data) => {
                nickname = data;
                next();
             }, next);
        },
        function deleteActivityIfExist(next) {
            logger.log('Deleting old activity if it already exist...');
            DesignAutomationApi.deleteActivity(configFile.designAutomation.activityId).then(next, (error) => {
                next(error && error.status === 404 ? null : error);
            });
        },
        function createActivityVersion(next) {
            logger.log('Creating activity version 1...');
            let activityObjJson = activityTemplate({
                activityId: configFile.designAutomation.activityId,
                nickname: nickname,
                appId: configFile.designAutomation.appId,
                appAlias: configFile.designAutomation.appAlias,
                engineId: configFile.designAutomation.engineId
            });
            let activityObj = JSON.parse(activityObjJson);

            DesignAutomationApi.createActivity(activityObj).then((data) => next(), next);
        },
        function createActivityAlias(next) {
        logger.log('Creating activity alias pointing to version 1...');
            let aliasObjJson = aliasTemplate({
                id: configFile.designAutomation.activityAlias,
                version: 1
            });
            let aliasObj = JSON.parse(aliasObjJson);

            DesignAutomationApi.createActivityAlias(configFile.designAutomation.activityId, aliasObj).then((data) => next(), next);
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
        logger.log('Finished creating activity');
        process.exit(0);
    });
}

createActivity();