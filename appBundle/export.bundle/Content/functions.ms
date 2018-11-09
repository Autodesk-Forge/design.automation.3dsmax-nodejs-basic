fn customMaxscriptFunctionDefinedInAppBundleToExportToFBX = 
(
	openLog @"script.log" mode: "w"

	logsystem.logEntry "Begin FBX export process" info:true broadcast:true

	outputpath = sysInfo.currentdir + "/output.fbx"

	logstr = "Exporting to : " + outputpath
	logsystem.logEntry logstr info:true broadcast:true

	exportFile outputpath #noPrompt using:FBXEXP
	logsystem.logEntry "Export completed" info:true broadcast:true
)