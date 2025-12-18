// Global function for the popup button
if (!window.groovyDebugSendToIDE) {
  window.groovyDebugSendToIDE = async function () {
    const debugData = window.currentGroovyDebugData;
    await sendToExternalIDE({}, debugData); // settings empty, but function uses debugData
    showToast(`Debug data sent to IDE`, "Success");
    $("#cpiHelper_semanticui_modal").modal("hide");
  };
}

// Create popup content for Groovy debug data
async function createGroovyDebugContent(data) {
  let bodyContent = formatTrace(data.payload || "No payload", "groovyDebugBody", null, "payload.txt");

  let headersContent = formatHeadersAndPropertiesToTable(
    data.headers
      ? Object.keys(data.headers)
          .sort()
          .map((key) => ({ Name: key, Value: data.headers[key] }))
      : []
  );

  let propertiesContent = formatHeadersAndPropertiesToTable(
    data.properties
      ? Object.keys(data.properties)
          .sort()
          .map((key) => ({ Name: key, Value: data.properties[key] }))
      : []
  );

  let scriptContent = `<div style="white-space: pre-wrap; font-family: monospace;">${data.groovyScript || "Script not available"}</div>`;

  let objects = [
    { label: "Body", content: bodyContent, active: true },
    { label: "Headers", content: headersContent, active: false },
    { label: "Properties", content: propertiesContent, active: false },
    { label: "Script", content: scriptContent, active: false },
  ];

  let tabsContent = await createTabHTML(objects, "groovyDebugTabs");

  // Store data globally for button access
  window.currentGroovyDebugData = data;

  return tabsContent;
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

      showWaitingPopup("Fetching iFlow data, trace information and highlighting Groovy steps with data...", "ui blue");

      try {
        const baseUrl = "https://" + pluginHelper.tenant + "/api/1.0/workspace/";
        const iFlowUrl = await getIFlowUrl(pluginHelper, baseUrl);

        if (!iFlowUrl) {
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
        };

        setupGroovyClickHandlers(settings, runInfo, groovyElementsWithTrace, iFlowData, iFlowUrl);

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

// Get the flow URL
async function getIFlowUrl(pluginHelper, baseUrl) {
  try {
    const packageId = pluginHelper.currentPackageId || pluginHelper.lastVisitedPackageId;

    if (!packageId) {
      log.error("No package ID found");
      return null;
    }

    // Fetch workspace
    const workspaceResponse = await fetch(baseUrl);
    if (!workspaceResponse.ok) {
      throw new Error(`Workspace fetch failed: ${workspaceResponse.status}`);
    }
    const workspaces = await workspaceResponse.json();

    const workspace = workspaces.find((ws) => ws.technicalName === packageId);
    if (!workspace) {
      log.error("Workspace not found for package:", packageId);
      return null;
    }

    // Fetch artifacts
    const artifactsUrl = `${baseUrl}${workspace.id}/artifacts/`;
    const artifactsResponse = await fetch(artifactsUrl);
    if (!artifactsResponse.ok) {
      throw new Error(`Artifacts fetch failed: ${artifactsResponse.status}`);
    }
    const artifacts = await artifactsResponse.json();

    const flowId = pluginHelper.currentIflowId || pluginHelper.lastVisitedIflowId || pluginHelper.currentArtifactId;
    if (!flowId) {
      log.error("No flow ID found");
      return null;
    }

    const artifact = artifacts.find((a) => a.tooltip === flowId);
    if (!artifact) {
      log.error("Artifact not found for flow:", flowId);
      return null;
    }

    const entityId = artifact.entityID;
    const iFlowUrl = `${artifactsUrl}${entityId}/entities/${entityId}/iflows/${flowId}`;

    return iFlowUrl;
  } catch (error) {
    log.error("Error getting iFlow URL:", error);
    return null;
  }
}

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

// Reset Groovy highlighting
function resetGroovyHighlighting() {
  document.querySelectorAll("g[id^='BPMNShape_'] rect.activity").forEach((rect) => {
    rect.style.fill = ""; // Reset fill for all elements
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
function setupGroovyClickHandlers(settings, runInfo, groovyElements, iFlowData, iFlowUrl) {
  groovyElements.forEach((element) => {
    const selector = `g#BPMNShape_${element.id}`;
    const targetElement = document.querySelector(selector);

    if (targetElement) {
      targetElement.style.cursor = "pointer";
      targetElement.onclick = async (event) => {
        event.stopPropagation();
        event.preventDefault();

        try {
          // Get the script content
          let groovyScriptContent = "";
          if (element.script) {
            const scriptUrl = iFlowUrl + element.script;
            try {
              const scriptResponse = await fetch(scriptUrl);
              const scriptData = await scriptResponse.json();
              groovyScriptContent = scriptData.content || "";
            } catch (scriptError) {
              log.error("Error fetching groovy script content:", scriptError);
            }
          }

          // Try to get trace data for this element if available
          let debugData = await tryGetTraceDataForElement(runInfo, element);

          if (!debugData) {
            // Create basic debug data if no trace available
            debugData = {
              messageGuid: runInfo.messageGuid,
              stepId: element.id,
              scriptName: element.displayName,
              groovyScript: groovyScriptContent || "// Script content not available",
              scriptFunction: element.scriptFunction || "processData",
              timestamp: new Date().toISOString(),
            };
          } else {
            // Add script content to trace data
            debugData.groovyScript = groovyScriptContent || "// Script content not available";
            debugData.scriptFunction = element.scriptFunction || "processData";
          }

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

// Try to get trace data for a specific element
async function tryGetTraceDataForElement(runInfo, element) {
  try {
    // First, get trace elements to see if this step was executed
    var logRuns = await createInlineTraceElements(runInfo.messageGuid, false);
    if (!logRuns || !inlineTraceElements?.length) {
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

    // Get payload (body)
    var payload = "";
    try {
      payload = await makeCallPromise("GET", "/" + cpiData.urlExtension + "odata/api/v1/TraceMessages(" + traceId + ")/$value", true);
    } catch (e) {
      log.log("No payload for this step");
    }

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

    // Get headers
    var headers = {};
    try {
      var headersData = JSON.parse(await makeCallPromise("GET", "/" + cpiData.urlExtension + "odata/api/v1/TraceMessages(" + traceId + ")/Properties?$format=json", true)).d.results;
      headersData.forEach((header) => {
        headers[header.Name] = header.Value;
      });
    } catch (e) {
      log.log("No headers for this step");
    }

    var groovyScript = "// Groovy script content not available via API\n// Please check your integration flow for the actual script";

    return {
      messageGuid: messageGuid,
      stepId: groovyStep.StepId,
      runId: runId,
      childCount: childCount,
      payload: payload,
      properties: properties,
      headers: headers,
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
  let payload = debugData.payload;
  let headers = debugData.headers || {};
  let properties = debugData.properties || {};

  // Build the JSON structure from actual debug data
  let dataObject = {
    input: {
      body: debugData.payload,
      headers: debugData.headers || {},
      properties: debugData.properties || {},
    },
    script: {
      code: debugData.groovyScript,
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
