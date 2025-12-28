var plugin = {
    metadataVersion: "1.0.0",
    id: "environment-traffic-light",
    name: "Environment Traffic Light (Multi-Keyword)",
    version: "1.1.0",
    author: "Aman Anand",
    email: "contact@amananand.in",
    website: "https://amananand.in",
    description: "Adds a colored safety header. Supports multiple keywords (comma-separated).",
    
  settings: {
        "info": { 
            text: "Zero-configuration mode enabled. This plugin automatically identifies the active environment context (Production, Quality, or Development) by analyzing the tenant URL for standard keywords.", 
            type: "label" 
        }
    },

    heartbeat: async (pluginHelper, settings) => {
        
        // 1. Hardcoded "Super Lists" of Synonyms
        const KEYWORDS = {
            PROD: ["prod", "production", "prd", "live"],
            TEST: ["test", "tst", "qa", "quality", "uat", "stage", "staging", "pre-prod"],
            DEV:  ["dev", "development", "trial", "sandbox", "sbx", "poc", "demo"]
        };

        // 2. Matcher Logic (Domain Only)
        const checkMatch = (keywordList) => {
            const currentDomain = window.location.hostname.toLowerCase();
            // Return true if ANY keyword is found in the domain
            return keywordList.some(k => currentDomain.includes(k));
        };

        // 3. Define Environments (Priority: Prod > Test > Dev)
        const environments = [
            { 
                type: "PROD",
                isMatch: checkMatch(KEYWORDS.PROD), 
                color: "#8B0000", // Dark Red
                text: "⚠ PRODUCTION ENVIRONMENT" 
            },
            { 
                type: "TEST",
                isMatch: checkMatch(KEYWORDS.TEST), 
                color: "#D35400", // Orange
                text: "TEST / QA SYSTEM" 
            },
            { 
                type: "DEV",
                isMatch: checkMatch(KEYWORDS.DEV), 
                color: "#218c54", // Green
                text: "DEVELOPMENT / SANDBOX" 
            }
        ];

        // Find the FIRST match
        const activeEnv = environments.find(env => env.isMatch);

        const barId = "cpi-helper-top-injector-bar";
        let bar = document.getElementById(barId);
        const shell = document.getElementById("shell") || document.querySelector(".sapUshellShell") || document.body;

        // 4. Logic: No Match -> Reset
        if (!activeEnv) {
            if (bar) bar.remove();
            if (shell && shell.id === "shell") {
                shell.style.top = "";
                shell.style.height = "";
            } else {
                document.body.style.marginTop = "";
            }
            return;
        }

        // 5. Logic: Match Found -> Render
        if (!bar) {
            bar = document.createElement("div");
            bar.id = barId;
            Object.assign(bar.style, {
                width: "100%", height: "25px", textAlign: "center", lineHeight: "25px",
                fontSize: "12px", fontWeight: "bold", letterSpacing: "1px",
                position: "fixed", top: "0", left: "0", zIndex: "999999",
                boxShadow: "0 2px 5px rgba(0,0,0,0.3)", color: "white"
            });
            bar.style.backgroundColor = activeEnv.color;
            bar.innerText = activeEnv.text;
            document.body.appendChild(bar);

            // Push Content Down
            if (shell && shell.id === "shell") {
                shell.style.top = "25px";
                shell.style.position = "absolute";
                shell.style.height = "calc(100% - 25px)";
                shell.style.boxSizing = "border-box";
            } else {
                document.body.style.marginTop = "25px";
            }
        } else {
            // Update existing bar
            if (bar.innerText !== activeEnv.text || bar.style.backgroundColor !== activeEnv.color) {
                bar.style.backgroundColor = activeEnv.color;
                bar.innerText = activeEnv.text;
            }
            // Enforce Push
            if (shell && shell.id === "shell" && shell.style.top !== "25px") {
                shell.style.top = "25px";
                shell.style.height = "calc(100% - 25px)";
            }
        }
    }
};

pluginList.push(plugin);