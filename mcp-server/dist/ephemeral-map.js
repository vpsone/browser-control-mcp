"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class EphemeralMap {
    map = new Map();
    timeouts = new Map();
    expirationTimeMS;
    constructor(expirationTimeMS = 500) {
        this.expirationTimeMS = expirationTimeMS;
    }
    /**
     * Sets a value for the specified key
     * @param key The key to set
     * @param value The value to associate with the key
     */
    set(key, value) {
        // Clear any existing timeout for this key
        this.clearTimeout(key);
        // Set the new value
        this.map.set(key, value);
        // Create a new timeout
        const timeout = setTimeout(() => {
            this.map.delete(key);
            this.timeouts.delete(key);
        }, this.expirationTimeMS);
        // Store the timeout reference
        this.timeouts.set(key, timeout);
    }
    /**
     * Gets and immediately deletes the value associated with the key
     * @param key The key to retrieve and delete
     * @returns The value associated with the key, or undefined if the key doesn't exist
     */
    getAndDelete(key) {
        if (!this.map.has(key)) {
            return undefined;
        }
        // Get the value
        const value = this.map.get(key);
        // Delete the key and clear its timeout
        this.map.delete(key);
        this.clearTimeout(key);
        return value;
    }
    /**
     * Helper method to clear a timeout for a specific key
     * @param key The key whose timeout to clear
     */
    clearTimeout(key) {
        if (this.timeouts.has(key)) {
            clearTimeout(this.timeouts.get(key));
            this.timeouts.delete(key);
        }
    }
    /**
     * Clears all data and timeouts from the map
     */
    clear() {
        // Clear all timeouts
        this.timeouts.forEach(timeout => clearTimeout(timeout));
        // Clear both maps
        this.timeouts.clear();
        this.map.clear();
    }
    /**
     * Gets the number of entries in the map
     */
    get size() {
        return this.map.size;
    }
    /**
     * Checks if a key exists in the map
     * @param key The key to check
     */
    has(key) {
        return this.map.has(key);
    }
}
exports.default = EphemeralMap;
