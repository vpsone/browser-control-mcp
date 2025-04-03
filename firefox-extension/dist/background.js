"use strict";
(() => {
  // auth.ts
  function buf2hex(buffer) {
    return Array.from(new Uint8Array(buffer)).map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  async function getMessageSignature(message, secretKey) {
    if (secretKey.length === 0) {
      throw new Error("Secret key is empty");
    }
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secretKey);
    const messageData = encoder.encode(message);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const rawSignature = await crypto.subtle.sign(
      { name: "HMAC" },
      key,
      messageData
    );
    return buf2hex(rawSignature);
  }

  // background.ts
  var WS_PORTS = [8081, 8082];
  var configUrl = browser.runtime.getURL("dist/config.json");
  async function getConfig() {
    const response = await fetch(configUrl);
    if (!response.ok) {
      throw new Error(
        "Failed to load config.json - make sure to run the postbuild step in the root directory"
      );
    }
    const config = await response.json();
    return config;
  }
  function initWsClient(port, secret) {
    let socket = null;
    function connectWebSocket() {
      console.log("Connecting to WebSocket server");
      socket = new WebSocket(`ws://localhost:${port}`);
      socket.addEventListener("open", () => {
        console.log("Connected to WebSocket server at port", port);
      });
      socket.addEventListener("message", async (event) => {
        console.log("Message from server:", event.data);
        try {
          const signedMessage = JSON.parse(event.data);
          const messageSig = await getMessageSignature(
            JSON.stringify(signedMessage.payload),
            secret
          );
          if (messageSig.length === 0 || messageSig !== signedMessage.signature) {
            console.error("Invalid message signature");
            return;
          }
          handleDecodedMessage(signedMessage.payload);
        } catch (error) {
          console.error("Failed to parse message:", error);
        }
      });
      socket.addEventListener("error", (event) => {
        console.error("WebSocket error:", event);
        socket && socket.close();
      });
    }
    function handleDecodedMessage(req) {
      switch (req.cmd) {
        case "open-tab":
          openUrl(req.correlationId, req.url);
          break;
        case "close-tabs":
          closeTabs(req.tabIds);
          break;
        case "get-tab-list":
          sendTabs(req.correlationId);
          break;
        case "get-browser-recent-history":
          sendRecentHistory(req.correlationId, req.searchQuery);
          break;
        case "get-tab-content":
          sendTabsContent(req.correlationId, req.tabId);
          break;
        case "reorder-tabs":
          reorderTabs(req.correlationId, req.tabOrder);
          break;
        case "find-highlight":
          findAndHighlightText(req.correlationId, req.tabId, req.queryPhrase);
          break;
        default:
          const _exhaustiveCheck = req;
          console.error("Invalid message received:", req);
      }
    }
    async function sendResourceToServer(resource) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.error("Socket is not open");
        return;
      }
      const signedMessage = {
        payload: resource,
        signature: await getMessageSignature(JSON.stringify(resource), secret)
      };
      socket.send(JSON.stringify(signedMessage));
    }
    async function openUrl(correlationId, url) {
      if (!url.startsWith("https://")) {
        console.error("Invalid URL:", url);
      }
      const tab = await browser.tabs.create({
        url
      });
      await sendResourceToServer({
        resource: "opened-tab-id",
        correlationId,
        tabId: tab.id
      });
    }
    function closeTabs(tabIds) {
      browser.tabs.remove(tabIds).then(() => {
        console.log(`Successfully closed ${tabIds.length} tabs`);
      }).catch((error) => {
        console.error(`Error closing tabs: ${error}`);
      });
    }
    function sendTabs(correlationId) {
      browser.tabs.query({}).then(async (tabs) => {
        await sendResourceToServer({
          resource: "tabs",
          correlationId,
          tabs
        });
      });
    }
    function sendRecentHistory(correlationId, searchQuery = null) {
      browser.history.search({
        text: searchQuery ?? "",
        // Search for all URLs (empty string matches everything)
        maxResults: 200,
        // Limit to 200 results
        startTime: 0
        // Search from the beginning of time
      }).then(async (historyItems) => {
        const filteredHistoryItems = historyItems.filter((item) => {
          return !!item.url;
        });
        await sendResourceToServer({
          resource: "history",
          correlationId,
          historyItems: filteredHistoryItems
        });
      }).catch((error) => {
        console.error(`Error fetching history: ${error}`);
      });
    }
    function sendTabsContent(correlationId, tabId) {
      browser.tabs.executeScript(tabId, {
        code: `
      (function () {
        function getLinks() {
          const linkElements = document.querySelectorAll('a[href]');
          return Array.from(linkElements).map(el => ({
            url: el.href,
            text: el.innerText.trim() || el.getAttribute('aria-label') || el.getAttribute('title') || ''
          })).filter(link => link.text !== '' && link.url !== '');
        }

        return {
          links: getLinks(),
          fullText: document.body.innerText
        };
      })();
    `
      }).then(async (results) => {
        const firstFrameResult = results[0];
        await sendResourceToServer({
          resource: "tab-content",
          tabId,
          correlationId,
          fullText: firstFrameResult.fullText,
          links: firstFrameResult.links
        });
      }).catch((error) => {
        console.error(
          "sendTabsContent for tab ID %s - Error executing script:",
          tabId,
          error
        );
      });
    }
    async function reorderTabs(correlationId, tabOrder) {
      for (let newIndex = 0; newIndex < tabOrder.length; newIndex++) {
        const tabId = tabOrder[newIndex];
        try {
          await browser.tabs.move(tabId, { index: newIndex });
        } catch (error) {
          console.error(`Error moving tab ${tabId}: ${error}`);
        }
      }
      sendResourceToServer({
        resource: "tabs-reordered",
        correlationId,
        tabOrder
      });
    }
    async function findAndHighlightText(correlationId, tabId, queryPhrase) {
      const findResults = await browser.find.find(queryPhrase, {
        tabId,
        caseSensitive: true
      });
      if (findResults.count > 0) {
        browser.find.highlightResults({
          tabId
        });
      }
      sendResourceToServer({
        resource: "find-highlight-result",
        correlationId,
        noOfResults: findResults.count
      });
    }
    connectWebSocket();
    setInterval(() => {
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        connectWebSocket();
      }
    }, 2e3);
  }
  getConfig().then((config) => {
    const secret = config.secret;
    if (!secret) {
      console.error("Secret not found in config.json");
      return;
    }
    for (const port of WS_PORTS) {
      initWsClient(port, secret);
    }
    console.log("Browser extension initialized");
  }).catch((error) => {
    console.error("Error loading config.json:", error);
  });
})();
