// Global function for the popup button
if (!window.groovyDebugSendToIDE) {
  window.groovyDebugSendToIDE = async function () {
    const debugData = window.currentGroovyDebugData;
    await sendToExternalIDE({}, debugData); // settings empty, but function uses debugData
    showToast(`Debug data sent to IDE`, "Success");
    $("#cpiHelper_semanticui_modal").modal("hide");
  };
}

// Direct API call to get artifactId
async function getArtifactIdDirectly() {
  try {
    if (cpiData.cpiPlatform === "neo") {
      // For Neo platform
      const listResponse = await makeCallPromise("GET", "/" + cpiData.urlExtension + "Operations/com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentsListCommand", false, null, null, null, null, true);
      const listData = new XmlToJson().parse(listResponse)["com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentsListResponse"];
      const artifact = Array.isArray(listData.artifactInformations)
        ? listData.artifactInformations.find((e) => e.symbolicName === cpiData.integrationFlowId)
        : listData.artifactInformations?.symbolicName === cpiData.integrationFlowId
        ? listData.artifactInformations
        : null;

      if (!artifact) {
        throw new Error("Integration Flow not found in list");
      }

      const detailResponse = await makeCallPromise(
        "GET",
        "/" + cpiData.urlExtension + "Operations/com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentDetailCommand?artifactId=" + artifact.id,
        60,
        "application/json",
        null,
        null,
        null,
        true
      );
      const detailData = JSON.parse(detailResponse);

      return detailData.artifactInformation.id;
    } else {
      // For CF platform - simplified version
      const listResponse = await makeCallPromise("GET", "/" + cpiData.urlExtension + "Operations/com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentsListCommand", false, null, null, null, null, true);
      const listData = new XmlToJson().parse(listResponse)["com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentsListResponse"];
      const artifact = Array.isArray(listData.artifactInformations)
        ? listData.artifactInformations.find((e) => e.symbolicName === cpiData.integrationFlowId)
        : listData.artifactInformations?.symbolicName === cpiData.integrationFlowId
        ? listData.artifactInformations
        : null;

      if (!artifact) {
        throw new Error("Integration Flow not found in list");
      }

      return artifact.id; // For CF, the artifact id from list might be sufficient
    }
  } catch (error) {
    log.error("Error getting artifactId directly:", error);
    throw error;
  }
}

// Create popup content for Groovy debug data
async function createGroovyDebugContent(data) {
  // Lazy load body content when Body tab is activated
  let bodyContent = async () => {
    try {
      let payload = await makeCallPromise("GET", "/" + cpiData.urlExtension + "odata/api/v1/TraceMessages(" + data.traceId + ")/$value", true);
      return formatTrace(payload || "No payload", "groovyDebugBody", null, "payload.txt");
    } catch (error) {
      log.error("Error fetching body content:", error);
      return "<div>No body data available</div>";
    }
  };

  // Lazy load headers content when Headers tab is activated
  let headersContent = async () => {
    try {
      let headersData = JSON.parse(await makeCallPromise("GET", "/" + cpiData.urlExtension + "odata/api/v1/TraceMessages(" + data.traceId + ")/Properties?$format=json", true)).d.results;
      let headers = {};
      headersData.forEach((header) => {
        headers[header.Name] = header.Value;
      });
      return formatHeadersAndPropertiesToTable(
        Object.keys(headers)
          .sort()
          .map((key) => ({ Name: key, Value: headers[key] }))
      );
    } catch (error) {
      log.error("Error fetching headers content:", error);
      return "<div>No headers data available</div>";
    }
  };

  let propertiesContent = formatHeadersAndPropertiesToTable(
    data.properties
      ? Object.keys(data.properties)
          .sort()
          .map((key) => ({ Name: key, Value: data.properties[key] }))
      : []
  );

  // Lazy load script content when Script tab is activated
  let scriptContent = async () => {
    try {
      if (data.scriptInfo && data.scriptInfo.scriptPath) {
        let scriptPath = data.scriptInfo.scriptPath;
        if (scriptPath.startsWith("/script/")) {
          scriptPath = scriptPath.replace("/script/", "//");
        }
        const scriptUrl = "https://" + data.scriptInfo.tenant + "/api/1.0/iflows/" + data.scriptInfo.artifactId + "/script/" + scriptPath;
        const scriptResponse = await fetch(scriptUrl);
        const scriptData = await scriptResponse.json();
        const groovyScriptContent = scriptData.content || "// Script content not available";
        return `<div style="white-space: pre-wrap; font-family: monospace;">${groovyScriptContent}</div>`;
      } else {
        return `<div style="white-space: pre-wrap; font-family: monospace;">// Script content not available</div>`;
      }
    } catch (error) {
      log.error("Error fetching script content:", error);
      return `<div style="white-space: pre-wrap; font-family: monospace;">// Error loading script content</div>`;
    }
  };

  // Get Log content from stored run step data
  let logContent = formatLogContent(data.runStepData?.RunStepProperties?.results || []);

  // Get Info content from stored run step data
  let infoContent = formatInfoContent(data.runStepData || {});

  let objects = [
    { label: "Properties", content: propertiesContent, active: true },
    { label: "Headers", content: headersContent, active: false },
    { label: "Body", content: bodyContent, active: false },
    { label: "Script", content: scriptContent, active: false },
    { label: "Log", content: logContent, active: false },
    { label: "Info", content: infoContent, active: false },
  ];

  let tabsContent = await createTabHTML(objects, "groovyDebugTabs");

  // Store data globally for button access
  window.currentGroovyDebugData = data;

  return tabsContent;
}

// Helper functions copied from contentScript.js for formatting
function formatLogContent(inputList) {
  inputList = inputList.sort(function (a, b) {
    return a.Name.toLowerCase() > b.Name.toLowerCase() ? 1 : -1;
  });
  result = `<table class='ui basic striped selectable compact table'>
  <thead><tr class="blue"><th>Name</th><th>Value</th></tr></thead>
  <tbody>`;
  inputList.forEach((item) => {
    result += "<tr><td>" + item.Name + '</td><td style="word-break: break-all;">' + item.Value + "</td></tr>";
  });
  result += "</tbody></table>";
  return result;
}

function formatInfoContent(inputList) {
  valueList = [];

  var stepStart = new Date(parseInt(inputList.StepStart.substr(6, 13)));
  stepStart.setTime(stepStart.getTime() - stepStart.getTimezoneOffset() * 60 * 1000);

  valueList.push({
    Name: "Start Time",
    Value: stepStart.toISOString().substr(0, 23),
  });

  if (inputList.StepStop) {
    var stepStop = new Date(parseInt(inputList.StepStop.substr(6, 13)));
    stepStop.setTime(stepStop.getTime() - stepStop.getTimezoneOffset() * 60 * 1000);
    valueList.push({
      Name: "End Time",
      Value: stepStop.toISOString().substr(0, 23),
    });
    valueList.push({
      Name: "Duration in milliseconds",
      Value: stepStop - stepStart,
    });
    valueList.push({
      Name: "Duration in seconds",
      Value: (stepStop - stepStart) / 1000,
    });
    valueList.push({
      Name: "Duration in minutes",
      Value: (stepStop - stepStart) / 1000 / 60,
    });
  }

  valueList.push({ Name: "BranchId", Value: inputList.BranchId });

  valueList.push({ Name: "RunId", Value: inputList.RunId });

  valueList.push({ Name: "StepId", Value: inputList.StepId });

  valueList.push({ Name: "ModelStepId", Value: inputList.ModelStepId });

  valueList.push({ Name: "ChildCount", Value: inputList.ChildCount });

  result = `<table class='ui basic striped selectable compact table'><thead><tr class="blue"><th>Name</th><th>Value</th></tr></thead>
  <tbody>`;
  valueList.forEach((item) => {
    result += "<tr><td>" + item.Name + '</td><td style="word-break: break-all;">' + item.Value + "</td></tr>";
  });
  result += "</tbody></table>";
  return result;
}

var plugin = {
  metadataVersion: "1.0.0",
  id: "groovyDebugger",
  name: "GroovyDebugX IDE",
  version: "1.0.0",
  author: "Sunil Pharswan",
  email: "sunilpharswan4198@gmail.com",
  website: "https://linkedin.com/in/sunilph",
  description:
    "<b>GroovyDebugX</b> streamlines Groovy debugging by automating runtime trace extraction. With visual step highlighting and one-click data transfer to <b>Groovy WebIDE</b>, it eliminates manual data entry and accelerates your integration development.<br><br><b>Note</b>: Requires the message to be processed in <b>Trace Mode</b> to capture and transfer runtime data.",
  settings: {},
  messageSidebarButton: {
    icon: { text: "{}", type: "text" },
    title: "Debug Groovy Steps",
    onClick: async (pluginHelper, settings, runInfo, active) => {
      resetGroovyHighlighting();

      if (!active) {
        return; // Deselected, just clear and exit
      }

      // Get artifactId directly via API call
      const artifactId = await getArtifactIdDirectly();
      console.log("Direct API call artifactId:", artifactId);

      //console.log(pluginHelper);
      //console.log(runInfo);

      showWaitingPopup("Fetching iFlow data, trace information and highlighting Groovy steps with data...", "ui blue");

      try {
        const iFlowUrl = "https://" + pluginHelper.tenant + "/api/1.0/iflows/" + artifactId;

        if (!artifactId) {
          $("#cpiHelper_waiting_model").modal("hide");
          showToast("Could not fetch iFlow structure - make sure you're on an integration flow page", "Groovy Debugger", "Error");
          return;
        }

        // Fetch the iFlow JSON structure
        const response = await fetch(iFlowUrl);
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const iFlowData = await response.json();
        //console.log(iFlowData);

        // Extract groovy script elements
        const groovyElements = extractGroovyElements(iFlowData);

        if (groovyElements.length === 0) {
          $("#cpiHelper_waiting_model").modal("hide");
          showToast("No Groovy Script steps found in this integration flow", "Groovy Debugger", "Warning");
          return;
        }

        log.log("Groovy Debugger: Found " + groovyElements.length + " groovy script elements");

        // Reset any existing highlighting
        resetGroovyHighlighting();

        // Get trace elements to identify which groovy steps have been executed
        const logRuns = await createInlineTraceElements(runInfo.messageGuid, false);
        if (!logRuns || !inlineTraceElements?.length) {
          $("#cpiHelper_waiting_model").modal("hide");
          showToast("No trace data found for this message", "Groovy Debugger", "Warning");
          return;
        }

        // Find groovy elements that have corresponding trace data
        const groovyElementsWithTrace = groovyElements.filter((element) => {
          const matchingTraceElements = inlineTraceElements.filter((traceElement) => {
            const traceId = traceElement.StepId || traceElement.ModelStepId;
            return traceId === element.id;
          });
          return matchingTraceElements.length > 0;
        });

        if (groovyElementsWithTrace.length === 0) {
          $("#cpiHelper_waiting_model").modal("hide");
          showToast("No Groovy steps with trace data found in this message", "Groovy Debugger", "Warning");
          return;
        }

        // Highlight only groovy script elements that have trace data
        applyGroovyHighlighting(groovyElementsWithTrace);

        // Store data for click handling
        window.groovyDebuggerData = {
          settings: settings,
          runInfo: runInfo,
          groovyElements: groovyElementsWithTrace,
          iFlowData: iFlowData,
          iFlowUrl: iFlowUrl,
          artifactId: artifactId,
          inlineTraceElements: inlineTraceElements,
        };

        setupGroovyClickHandlers(settings, runInfo, groovyElementsWithTrace, iFlowData, artifactId, pluginHelper.tenant);

        $("#cpiHelper_waiting_model").modal("hide");
        showToast("Groovy steps with data highlighted - click on any highlighted Groovy step to debug", "Success");
      } catch (error) {
        log.error("Error in Groovy Debugger:", error);
        showToast("Error: " + error.message, "Groovy Debugger", "Error");
        $("#cpiHelper_waiting_model").modal("hide");
      }
    },
    condition: (pluginHelper, settings, runInfo) => {
      var date = new Date();
      date.setHours(date.getHours() - 1);
      return runInfo.logLevel === "trace" && runInfo.logStart > date;
    },
  },
};

// Extract Groovy elements from iFlow JSON
function extractGroovyElements(iFlowData) {
  if (!iFlowData.propertyViewModel?.listOfDefaultFlowElementModel) {
    return [];
  }

  return iFlowData.propertyViewModel.listOfDefaultFlowElementModel
    .filter((element) => element.displayName === "Groovy Script")
    .map((element) => ({
      id: element.id,
      displayName: element.displayName,
      scriptFunction: element.allAttributes?.scriptFunction?.value || "processData",
      script: element.allAttributes?.script?.value || "",
    }));
}

// Reset Groovy highlighting and remove click handlers
function resetGroovyHighlighting() {
  document.querySelectorAll("g[id^='BPMNShape_'] rect.activity").forEach((rect) => {
    rect.style.fill = ""; // Reset fill for all elements
  });
  // Remove click handlers and cursor style from all BPMN shape elements
  document.querySelectorAll("g[id^='BPMNShape_']").forEach((element) => {
    element.style.cursor = "";
    element.onclick = null;
  });
}

// Apply green highlighting to found Groovy elements
function applyGroovyHighlighting(groovyElements) {
  groovyElements.forEach((element) => {
    const selector = `g#BPMNShape_${element.id}`;
    const targetElement = document.querySelector(selector);

    if (targetElement) {
      // Find the rect inside the g element and apply fill color
      const rectElement = targetElement.querySelector("rect.activity");
      if (rectElement) {
        rectElement.style.fill = "#13af00"; // Apply green fill for groovy steps
      }
    }
  });
}

// Set up click handlers for highlighted Groovy elements
function setupGroovyClickHandlers(settings, runInfo, groovyElements, iFlowData, artifactId, tenant) {
  groovyElements.forEach((element) => {
    const selector = `g#BPMNShape_${element.id}`;
    const targetElement = document.querySelector(selector);

    if (targetElement) {
      targetElement.style.cursor = "pointer";
      targetElement.onclick = async (event) => {
        event.stopPropagation();
        event.preventDefault();

        try {
          // Try to get trace data for this element if available
          let debugData = await tryGetTraceDataForElement(runInfo, element, window.groovyDebuggerData.inlineTraceElements);

          if (!debugData) {
            // Create basic debug data if no trace available
            debugData = {
              messageGuid: runInfo.messageGuid,
              stepId: element.id,
              scriptName: element.displayName,
              groovyScript: "// Script content not available",
              scriptFunction: element.scriptFunction || "processData",
              timestamp: new Date().toISOString(),
            };
          } else {
            // Set initial placeholder for script content (will be lazy loaded)
            debugData.groovyScript = "// Script content not available";
            debugData.scriptFunction = element.scriptFunction || "processData";
          }

          // Store script fetching info for lazy loading
          debugData.scriptInfo = {
            tenant: tenant,
            artifactId: artifactId,
            scriptPath: element.script,
          };

          // Check if there's meaningful data to display
          if ((!debugData.payload || debugData.payload === "") && Object.keys(debugData.headers || {}).length === 0 && Object.keys(debugData.properties || {}).length === 0) {
            showToast("No debug data available for this Groovy step", "Warning");
            return;
          }

          showBigPopup(await createGroovyDebugContent(debugData), `Groovy Debug Data - ${element.displayName || element.id}`, {
            fullscreen: false,
            callback: () => {
              let actionsDiv = $("#cpiHelper_semanticui_modal .actions");
              let debugBtn = $('<div class="ui positive button"><i class="rocket icon"></i>Debug Externally</div>');
              debugBtn.on("click", () => window.groovyDebugSendToIDE());
              actionsDiv.prepend(debugBtn);
            },
          });
        } catch (error) {
          log.error("Error in groovy click handler:", error);
          showToast("Error: " + error.message, "Error");
        }
      };
    }
  });
}

// Try to get trace data for a specific element using pre-fetched trace elements
async function tryGetTraceDataForElement(runInfo, element, inlineTraceElements) {
  try {
    // Use the pre-fetched trace elements instead of fetching again
    if (!inlineTraceElements?.length) {
      return null; // No trace data available
    }

    // Find trace elements that match this groovy element by ID
    const matchingTraceElements = inlineTraceElements.filter((traceElement) => {
      const traceId = traceElement.StepId || traceElement.ModelStepId;
      return traceId === element.id;
    });

    if (matchingTraceElements.length === 0) {
      return null; // Step wasn't executed in this trace
    }

    // Get debug data for the first matching trace element
    return await fetchGroovyDebugData(runInfo, matchingTraceElements[0]);
  } catch (error) {
    log.error("Error getting trace data for element:", error);
    return null;
  }
}

// Helper function to fetch debug data for a Groovy step
async function fetchGroovyDebugData(runInfo, groovyStep) {
  try {
    var messageGuid = runInfo.messageGuid;
    var runId = groovyStep.RunId;
    var childCount = groovyStep.ChildCount;

    // Get trace messages for this step
    var traceData = JSON.parse(await makeCallPromise("GET", "/" + cpiData.urlExtension + "odata/api/v1/MessageProcessingLogRunSteps(RunId='" + runId + "',ChildCount=" + childCount + ")/TraceMessages?$format=json", true)).d.results;

    var traceInfo = traceData.find((trace) => trace.TraceId);

    if (!traceInfo) {
      return null;
    }

    var traceId = traceInfo.TraceId;

    // Payload will be fetched lazily when Body tab is activated

    // Get properties
    var properties = {};
    try {
      var propsData = JSON.parse(await makeCallPromise("GET", "/" + cpiData.urlExtension + "odata/api/v1/TraceMessages(" + traceId + ")/ExchangeProperties?$format=json", true)).d.results;
      propsData.forEach((prop) => {
        properties[prop.Name] = prop.Value;
      });
    } catch (e) {
      log.log("No properties for this step");
    }

    // Headers will be fetched lazily when Headers tab is activated

    // Get run step data with properties for Log and Info tabs
    var runStepData = {};
    try {
      runStepData = JSON.parse(await makeCallPromise("GET", "/" + cpiData.urlExtension + "odata/api/v1/MessageProcessingLogRunSteps(RunId='" + runId + "',ChildCount=" + childCount + ")/?$expand=RunStepProperties&$format=json", true)).d;
    } catch (e) {
      log.log("No run step data for this step");
    }

    var groovyScript = "// Groovy script content not available via API\n// Please check your integration flow for the actual script";

    return {
      messageGuid: messageGuid,
      stepId: groovyStep.StepId,
      runId: runId,
      childCount: childCount,
      traceId: traceId,
      properties: properties,
      runStepData: runStepData,
      groovyScript: groovyScript,
      scriptFunction: "processData", // Will be overridden by element.scriptFunction
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    log.error("Error fetching debug data:", error);
    return null;
  }
}

// Helper function for Base64URL encoding
function uint8ArrayToBase64Url(bytes) {
  // Convert Uint8Array to a binary string
  let binaryString = "";
  bytes.forEach((byte) => {
    binaryString += String.fromCharCode(byte);
  });

  // Standard Base64 encoding using the built-in browser function
  let base64 = btoa(binaryString);

  // Convert to URL-safe format and remove padding
  let base64Url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return base64Url;
}

// Compress data using pako deflateRaw for compatibility with Python zlib.decompress
function compressToBase64(dataString) {
  // Step A: Convert the JSON string into a Uint8Array (binary data)
  const dataBytes = new TextEncoder().encode(dataString);

  // Step B: Compress using pako.deflateRaw()
  // This creates the raw Deflate stream without Zlib/Gzip headers.
  const compressedBytes = pako.deflateRaw(dataBytes, { level: 9 }); // level 9 is max compression

  // Step C: Base64URL Encode the compressed binary data
  const encodedString = uint8ArrayToBase64Url(compressedBytes);

  return encodedString;
}

// Send data to external IDE
async function sendToExternalIDE(settings, debugData) {
  var ideUrl = "https://groovyide.com/cpi/share/v1/";

  // Use actual debug data
  let groovyScript = debugData.groovyScript;
  // If script not fetched yet (lazy loading), fetch it now
  if (groovyScript === "// Script content not available" && debugData.scriptInfo) {
    try {
      if (debugData.scriptInfo.scriptPath) {
        let scriptPath = debugData.scriptInfo.scriptPath;
        if (scriptPath.startsWith("/script/")) {
          scriptPath = scriptPath.replace("/script/", "//");
        }
        const scriptUrl = "https://" + debugData.scriptInfo.tenant + "/api/1.0/iflows/" + debugData.scriptInfo.artifactId + "/script/" + scriptPath;
        const scriptResponse = await fetch(scriptUrl);
        const scriptData = await scriptResponse.json();
        groovyScript = scriptData.content || "// Script content not available";
      }
    } catch (error) {
      log.error("Error fetching script for IDE:", error);
      groovyScript = "// Script content not available";
    }
  }
  let payload = debugData.payload;
  // If payload not fetched yet (lazy loading), fetch it now
  if (!payload && debugData.traceId) {
    try {
      payload = await makeCallPromise("GET", "/" + cpiData.urlExtension + "odata/api/v1/TraceMessages(" + debugData.traceId + ")/$value", true);
    } catch (error) {
      log.error("Error fetching payload for IDE:", error);
      payload = "";
    }
  }
  let headers = debugData.headers || {};
  // If headers not fetched yet (lazy loading), fetch them now
  if ((!headers || Object.keys(headers).length === 0) && debugData.traceId) {
    try {
      let headersData = JSON.parse(await makeCallPromise("GET", "/" + cpiData.urlExtension + "odata/api/v1/TraceMessages(" + debugData.traceId + ")/Properties?$format=json", true)).d.results;
      headers = {};
      headersData.forEach((header) => {
        headers[header.Name] = header.Value;
      });
    } catch (error) {
      log.error("Error fetching headers for IDE:", error);
      headers = {};
    }
  }
  let properties = debugData.properties || {};

  // Build the JSON structure from actual debug data
  let dataObject = {
    input: {
      body: payload,
      headers: headers,
      properties: debugData.properties || {},
    },
    script: {
      code: groovyScript,
      function: debugData.scriptFunction || "processData",
    },
  };

  let dataString = JSON.stringify(dataObject);

  // Compress and encode
  let encoded;
  encoded = await compressToBase64(dataString);
  // Make URL-safe and remove padding
  encoded = encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  var fullUrl = ideUrl + encoded;

  // Open in new tab/window
  window.open(fullUrl, "_blank");
}

pluginList.push(plugin);
