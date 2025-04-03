"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserAPI = void 0;
const ws_1 = __importDefault(require("ws"));
const util_1 = require("./util");
const ephemeral_map_1 = __importDefault(require("./ephemeral-map"));
const path_1 = require("path");
const promises_1 = require("fs/promises");
const crypto = __importStar(require("crypto"));
// Support up to two initializations of the MCP server by the client
// More initializations will result in EDADDRINUSE errors
const WS_PORTS = [8081, 8082];
class BrowserAPI {
    ws = null;
    wsServer = null;
    sharedSecret = null;
    // Local state representing the resources provided by the browser extension
    // These will be updated by an inbound message from the extension
    openTabs = new ephemeral_map_1.default();
    browserHistory = new ephemeral_map_1.default();
    tabContent = new ephemeral_map_1.default();
    openedTabId = new ephemeral_map_1.default();
    reorderedTabs = new ephemeral_map_1.default();
    findHighlightResults = new ephemeral_map_1.default();
    async init() {
        const { secret } = await readConfig();
        if (!secret) {
            throw new Error("Secret not found in config.json");
        }
        this.sharedSecret = secret;
        let selectedPort = null;
        for (const port of WS_PORTS) {
            if (!(await (0, util_1.isPortInUse)(port))) {
                selectedPort = port;
                break;
            }
        }
        if (!selectedPort) {
            throw new Error("All available ports are in use");
        }
        this.wsServer = new ws_1.default.Server({
            host: "localhost",
            port: selectedPort,
        });
        this.wsServer.on("connection", async (connection) => {
            this.ws = connection;
            this.ws.on("message", (message) => {
                const decoded = JSON.parse(message.toString());
                const signature = this.createSignature(JSON.stringify(decoded.payload));
                if (signature !== decoded.signature) {
                    console.error("Invalid message signature");
                    return;
                }
                this.handleDecodedResourceMessage(decoded.payload);
            });
        });
        this.wsServer.on("error", (error) => {
            console.error("WebSocket server error:", error);
        });
        return selectedPort;
    }
    close() {
        this.wsServer?.close();
    }
    getSelectedPort() {
        return this.wsServer?.options.port;
    }
    async openTab(url) {
        const correlationId = this.sendMessageToExtension({
            cmd: "open-tab",
            url,
        });
        await waitForResponse();
        return this.openedTabId.getAndDelete(correlationId);
    }
    async closeTabs(tabIds) {
        this.sendMessageToExtension({
            cmd: "close-tabs",
            tabIds,
        });
    }
    async getTabList() {
        const correlationId = this.sendMessageToExtension({
            cmd: "get-tab-list",
        });
        await waitForResponse();
        return this.openTabs.getAndDelete(correlationId);
    }
    async getBrowserRecentHistory(searchQuery) {
        const correlationId = this.sendMessageToExtension({
            cmd: "get-browser-recent-history",
            searchQuery,
        });
        await waitForResponse();
        return this.browserHistory.getAndDelete(correlationId);
    }
    async getTabContent(tabId) {
        const correlationId = this.sendMessageToExtension({
            cmd: "get-tab-content",
            tabId,
        });
        await waitForResponse();
        return this.tabContent.getAndDelete(correlationId);
    }
    async reorderTabs(tabOrder) {
        const correlationId = this.sendMessageToExtension({
            cmd: "reorder-tabs",
            tabOrder,
        });
        await waitForResponse();
        return this.reorderedTabs.getAndDelete(correlationId);
    }
    async findHighlight(tabId, queryPhrase) {
        const correlationId = this.sendMessageToExtension({
            cmd: "find-highlight",
            tabId,
            queryPhrase,
        });
        await waitForResponse();
        return this.findHighlightResults.getAndDelete(correlationId);
    }
    createSignature(payload) {
        if (!this.sharedSecret) {
            throw new Error("Shared secret not initialized");
        }
        const hmac = crypto.createHmac("sha256", this.sharedSecret);
        hmac.update(payload);
        return hmac.digest("hex");
    }
    sendMessageToExtension(message) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN) {
            throw new Error("WebSocket is not open");
        }
        const correlationId = Math.random().toString(36).substring(2);
        const req = { ...message, correlationId };
        const payload = JSON.stringify(req);
        const signature = this.createSignature(payload);
        const signedMessage = {
            payload: req,
            signature: signature,
        };
        // Send the signed message to the extension
        this.ws.send(JSON.stringify(signedMessage));
        return correlationId;
    }
    handleDecodedResourceMessage(decoded) {
        const { correlationId } = decoded;
        switch (decoded.resource) {
            case "tabs":
                this.openTabs.set(correlationId, decoded.tabs);
                break;
            case "history":
                this.browserHistory.set(correlationId, decoded.historyItems);
                break;
            case "opened-tab-id":
                this.openedTabId.set(correlationId, decoded.tabId);
                break;
            case "tab-content":
                this.tabContent.set(correlationId, decoded);
                break;
            case "tabs-reordered":
                this.reorderedTabs.set(correlationId, decoded.tabOrder);
                break;
            case "find-highlight-result":
                this.findHighlightResults.set(correlationId, decoded.noOfResults);
                break;
            default:
                const _exhaustiveCheck = decoded;
                console.error("Invalid resource message received:", decoded);
        }
    }
}
exports.BrowserAPI = BrowserAPI;
async function readConfig() {
    const configPath = (0, path_1.join)(__dirname, "config.json");
    const config = JSON.parse(await (0, promises_1.readFile)(configPath, "utf8"));
    return config;
}
async function waitForResponse() {
    // Wait for the extension to respond back on the same connection
    const WAIT_TIME_MS = 200;
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(true);
        }, WAIT_TIME_MS);
    });
}
