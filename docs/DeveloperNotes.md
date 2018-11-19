# Understanding the sample

## Creating the appbundle
In design automation, an appbundle can be used to provide custom code, plugins, scripts, and content that need to be used during every workitem execution.

In this sample we provide an appbundle that automatically loads a maxscript file on 3ds Max start up. 
 
The appbundle that is uploaded to design automation must be a zip that contains a folder with a name that ends with ```.bundle```.
In this folder there should be an xml file named [PackageContents.xml](../appBundle/export.bundle/PackageContents.xml).  This file will describe to 3ds Max what to load on start up. For more information about this xml file fomat check [here](https://help.autodesk.com/view/3DSMAX/2019/ENU/?guid=__developer_writing_plug_ins_packaging_plugins_packagexml_format_html).

In this sample, the [PackageContents.xml](../appBundle/export.bundle/PackageContents.xml) file specifies that [functions.ms](../appBundle/export.bundle/Content/functions.ms) must be loaded as a pre-start-up script.

In this script we define a maxscript function ```customMaxscriptFunctionDefinedInAppBundleToExportToFBX``` that contains the logic to export the current scene to FBX.

This function is used inside our activity definition, where we define the 3dsmaxbatch.exe command line to be executed.

The [createAndUploadApp.js](../createAndUploadApp.js) creates and uploads the appbundle following these steps:
1. Zip the [../appbundle/export.bundle](../appBundle/export.bundle) folder.
2. Delete the appbundle versions and alias that might already exist by calling [DELETE appbundles/:id](https://forge.autodesk.com/en/docs/design-automation/v3/reference/http/appbundles-id-DELETE/).
3. Create the first version of the appbundle by calling [POST appbundles](https://forge.autodesk.com/en/docs/design-automation/v3/reference/http/appbundles-POST/) using the [postApp.hbs](../templates/payloads/postApp.hbs) template to generate the body of the request.
4. Upload the zipped folder from step 1.  To do so, we take the form-data and url from the response received by creating the appbundle in step 3 and we add the field ```file``` where we add the content of the zip file.
5. Create an alias that points to version 1 of the appbundle by calling [POST appbundles/:id/aliases](https://forge.autodesk.com/en/docs/design-automation/v3/reference/http/appbundles-id-aliases-POST/) using the [postAlias.hbs](../templates/payloads/postAlias.hbs) template to generate the body of the request.

For more details take a look at the ```createApp``` inside [appCreator.js](../lib/appCreator.js).

Note: In an iterative process, it might be more appropriate to create new versions of your appbundle instead of deleting it every time. This can be done using [POST appbundles/:id/versions](https://forge.autodesk.com/en/docs/design-automation/v3/reference/http/appbundles-id-versions-GET/).

## Creating the activity
In design automation an activity defines what need to be executed when sending a workitem.  It also define what appbundle needs to be loaded and what are the parameters that will need to be provided when sending a workitem.

The [createActivity.js](../createActivity.js) script create the activity following these steps:
1. Delete the activity versions and alias that might already exist by calling [DELETE activities/:id](https://forge.autodesk.com/en/docs/design-automation/v3/reference/http/activities-id-DELETE/).
2. Create the first version of the activity by calling [POST activities](https://forge.autodesk.com/en/docs/design-automation/v3/reference/http/activities-POST/) using [postActivityExportToFBX.hbs](../templates/payloads/postActivityExportToFBX.hbs) template to generate the body of the requests.
3. Create an alias that points to version 1 of the appbundle by calling [POST activities/:id/aliases](https://forge.autodesk.com/en/docs/design-automation/v3/reference/http/activities-id-aliases-POST/) using [postAlias.hbs](../templates/payloads/postAlias.hbs) template to generate the body of the request.

For more detail you can look at the ```createActivity``` function in [activityCreator.js](../lib/activityCreator.js).

Note: In an iterative process, it might be more appropriate to create new versions of your activity instead of deleting it every time. This can be done using [POST activities/:id/versions](https://forge.autodesk.com/en/docs/design-automation/v3/reference/http/activities-id-versions-POST/).

## Object Storage Service (OSS)
When sending a workitem, we will need to provide urls to download the inputs and upload the output specified in the activity.

The [executeWorkitem.js](../executeWorkitem.js) script manages the upload of input 3ds Max files from your local machine to OSS.
It also manages the creation of signed urls that will be used for the arguments when sending the workitem.

Generating signed urls is done following these steps:
1. Retrieve the name of the bucket to use from the config file. Check the ```Setup Config file``` section of this README.md for more information.
2. Check if the bucket already exists and our forge app is the owner of the bucket.  This is done by calling [GET buckets/:bucketKey/details](https://forge.autodesk.com/en/docs/data/v2/reference/http/buckets-:bucketKey-details-GET/).
3. If the bucket doesn't exist, create it by calling [POST buckets](https://forge.autodesk.com/en/docs/data/v2/reference/http/buckets-POST/).
4. Generate the required signed url by calling [POST buckets/:bucketKey/objects/:objectName/signed](https://forge.autodesk.com/en/docs/data/v2/reference/http/buckets-:bucketKey-objects-:objectName-signed-POST/).

## Sending a workitem
The workitem launches the execution of an activity in design automation. The [executeWorkitem.js](../executeWorkitem.js) script does this by calling [POST workitems](https://forge.autodesk.com/en/docs/design-automation/v3/reference/http/workitems-POST/) using the [postWorkitemExportToFBX.bhs](../templates/payloads/postWorkitemExportToFBX.hbs) template to generate the body of the request.

NOTE: In this sample we wait for the workitem to complete by polling for its status using [GET workitems/:id](https://forge.autodesk.com/en/docs/design-automation/v3/reference/http/workitems-id-GET/) requests.  The prefered way to be notified when a workitem is completed is to register a callback url using the ```onComplete``` argument in the body when sending your [POST workitems](https://forge.autodesk.com/en/docs/design-automation/v3/reference/http/workitems-POST/) request.
This is a special argument that can be used without being defined in the activity.

Here is an example of how to use the onComplete argument:
```
    "arguments": {
        "onComplete": {
            "url": "https://yourUrlToCallbackHere.com/callback/on/complete"
            "verb": "post",
            "ondemand": true
        }
    }
```
## Downloading result
The resulting FBX file should be downloaded back from OSS in the ```Results``` folder. This folder will get created if it doesn't already exist.  The file will be named with the jobId which can be found the in console output when running [executeWorkitem.js](../executeWorkitem.js). 
