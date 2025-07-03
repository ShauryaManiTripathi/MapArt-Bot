const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');

/**
 * @class MinimalBot
 * @description A highly configurable and robust wrapper for a Mineflayer bot.
 * It provides selective plugin loading, graceful disconnection handling, and automatic reconnection capabilities.
 * Designed to be extended for creating powerful, custom bot implementations.
 *
 * @param {object} options - Configuration options for the bot, extending Mineflayer's options.
 * @param {boolean} [options.pluginsSuccessVerbose=false] - If true, prints a detailed status table of all plugins on the first spawn.
 * @param {string} [options.proxyHost] - The hostname or IP address of the SOCKS proxy server.
 * @param {number} [options.proxyPort] - The port of the SOCKS proxy server.
 * @param {4|5} [options.proxyType=5] - The SOCKS proxy version to use (4 or 5). Defaults to 5.
 * @param {string} [options.proxyUsername] - The username for SOCKS proxy authentication (optional).
 * @param {string} [options.proxyPassword] - The password for SOCKS proxy authentication (optional).
 * @param {object} [options.plugins={}] - A configuration object to enable and configure plugins.
 * @param {boolean|object} [options.plugins.pathfinder=false] - Enable the pathfinder plugin.
 * @param {boolean|object} [options.plugins.armorManager=false] - Enable the armor-manager plugin.
 * @param {boolean|object} [options.plugins.pvp=false] - Enable the custom-pvp plugin.
 * @param {boolean|object} [options.plugins.autoCrystal=false] - Enable the autocrystal plugin.
 * @param {boolean|object} [options.plugins.tool=false] - Enable the tool plugin.
 * @param {boolean|object} [options.plugins.autoEat=false] - Enable the auto-eat plugin.
 * @param {boolean|object} [options.plugins.viewer=false] - Enable the prismarine-viewer plugin.
 * @param {boolean} [options.autoReconnect=true] - Whether the bot should automatically try to reconnect.
 * @param {number} [options.reconnectDelay=5000] - The delay in milliseconds before attempting to reconnect.
 */
class MinimalBot {
    constructor(options = {}) {
        this._options = {
            host: 'localhost',
            port: 25565,
            username: 'MinimalBot',
            version: false,
            auth: 'mojang',
            autoReconnect: true,
            reconnectDelay: 5000,
            pluginsSuccessVerbose: false,
            proxyHost: null,
            proxyPort: null,
            proxyType: 5,
            proxyUsername: null,
            proxyPassword: null,
            plugins: {},
            ...options
        };

        this.bot = null;
        this._goals = null;
        this._movements = null;
        
        this._isDisconnecting = false;
        this._isReconnecting = false;
        this._isFirstSpawn = true; // For the verbose plugin report
        this._pluginStatus = {};   // To track plugin load status

        this._createBot();
    }

    _createBot() {
        const botOptions = { ...this._options };

        if (botOptions.proxyHost && botOptions.proxyPort) {
            console.log(`Connecting via SOCKS${botOptions.proxyType} proxy: ${botOptions.proxyHost}:${botOptions.proxyPort}`);
            const serverHost = botOptions.host, serverPort = botOptions.port;
            delete botOptions.host;
            delete botOptions.port;

            botOptions.connect = (client) => {
                SocksClient.createConnection({
                    proxy: { host: botOptions.proxyHost, port: botOptions.proxyPort, type: botOptions.proxyType, userId: botOptions.proxyUsername, password: botOptions.proxyPassword },
                    command: 'connect',
                    destination: { host: serverHost, port: serverPort }
                }, (err, info) => {
                    if (err) {
                        console.error("SOCKS proxy connection error:", err.message);
                        client.emit('error', err);
                        return;
                    }
                    client.setSocket(info.socket);
                    client.emit('connect');
                });
            };
        }

        this.bot = mineflayer.createBot(botOptions);
        this._loadPlugins();
        this._attachEventListeners();
    }
    
    /**
     * @private
     * Loads plugins and records their status for the verbose report.
     */
    _loadPlugins() {
        const plugins = this._options.plugins || {};
        this._pluginStatus = {};

        const loadPlugin = (name, loader) => {
            const isRequested = !!plugins[name];
            this._pluginStatus[name] = {
                'Plugin Name': name,
                'Requested': isRequested ? 'Yes' : 'No',
                'Loaded': '---'
            };

            if (isRequested) {
                try {
                    loader();
                    this._pluginStatus[name].Loaded = 'Success';
                } catch (e) {
                    console.error(`Could not load ${name} plugin:`, e.message);
                    this._pluginStatus[name].Loaded = 'Failed';
                }
            }
        };

        loadPlugin('pathfinder', () => {
            const { pathfinder, goals, Movements } = require('mineflayer-pathfinder-antilagback');
            this.bot.loadPlugin(pathfinder);
            this._goals = goals; this._movements = Movements;
        });

        loadPlugin('armorManager', () => {
            this.bot.loadPlugin(require('mineflayer-armor-manager'));
        });

        loadPlugin('pvp', () => {
            this.bot.loadPlugin(require('@nxg-org/mineflayer-custom-pvp').plugin);
        });

        loadPlugin('autoCrystal', () => {
            this.bot.loadPlugin(require('mineflayer-autocrystal').autoCrystal);
        });

        loadPlugin('tool', () => {
            this.bot.loadPlugin(require('mineflayer-tool').plugin);
        });

        loadPlugin('autoEat', () => {
            this.bot.loadPlugin(require('mineflayer-auto-eat').loader);
        });

        loadPlugin('viewer', () => {
            const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
            this.bot.once('spawn', () => {
                const viewerOptions = { port: plugins.viewer.port || 3000, firstPerson: plugins.viewer.firstPerson !== false };
                mineflayerViewer(this.bot, viewerOptions);
                console.log(`Prismarine viewer started on port ${viewerOptions.port}`);
            });
        });
    }

    _attachEventListeners() {
        this.bot.once('spawn', async () => {
            if (this._options.pluginsSuccessVerbose && this._isFirstSpawn) {
                this.printPluginStatus();
                this._isFirstSpawn = false;
            }

            // REMOVED: this._isReconnecting = false; // This was the cause of the bug.

            console.log(`${this.bot.username} has spawned.`);
            try { // ADDED: Safety wrapper for custom initialization logic.
                await this.initialize();
            } catch (err) {
                console.error("Error during custom initialization:", err);
            }
        });

        this.bot.on('kicked', (reason) => {
            // ADDED: Better logging for JSON kick reasons.
            const reasonText = typeof reason === 'string' ? reason : JSON.stringify(reason);
            console.log(`Bot was kicked for: ${reasonText}`);
            this.handleDisconnect('kicked');
        });

        this.bot.on('end', (reason) => {
            // Only handle 'end' if it wasn't preceded by a kick, as kick also causes an 'end' event.
            if (!this._isReconnecting) {
                console.log(`Bot has disconnected. Reason: ${reason || 'N/A'}`);
                this.handleDisconnect('end');
            }
        });

        this.bot.on('error', (err) => {
            console.error('Bot encountered an error:', err.message);
            // An error can often lead to a disconnect, so we trigger the handler here too.
            this.handleDisconnect('error');
        });
    }

    handleDisconnect(eventName) {
        if (this._isDisconnecting || this._isReconnecting) return;

        // Clean up listeners on the current bot instance to prevent memory leaks
        if (this.bot) {
            this.bot.removeAllListeners();
        }

        if (this._options.autoReconnect) {
            this._isReconnecting = true;
            console.log(`Attempting to reconnect in ${this._options.reconnectDelay / 1000} seconds...`);
            setTimeout(() => this.reconnect(), this._options.reconnectDelay);
        }
    }

    reconnect() {
        // This is now the single point of control for the reconnecting state.
        // Once this function runs, the "reconnecting" state is considered over,
        // and a new connection cycle begins.
        this._isReconnecting = false; // MOVED & CHANGED: Reset the flag here.
        
        console.log("Reconnecting...");
        this.disconnect(true); // Quietly disconnect old instance if it exists.
        this._createBot(); // Create a new bot instance and start connecting.
    }

    async initialize() {
        // This is a placeholder for child classes to override.
        return Promise.resolve();
    }

    disconnect(quiet = false) {
        if (!this.bot) return;
        if (quiet) this._isDisconnecting = true;
        
        // Ensure all bot activities are stopped before quitting.
        if (this.bot.pathfinder) this.bot.pathfinder.stop();
        
        if (typeof this.bot.quit === 'function') {
             this.bot.quit();
        }
        this.bot.removeAllListeners();
        
        if (quiet) {
            // Reset the flag after a short delay to prevent race conditions.
            setTimeout(() => { this._isDisconnecting = false; }, 1000);
        }
    }

    /**
     * @private
     * Prints a status table of all manageable plugins.
     */
    printPluginStatus() {
        console.log("\n--- MinimalBot Plugin Status ---");
        const statusData = Object.values(this._pluginStatus);
        if (statusData.length > 0) {
            console.table(statusData);
        } else {
            console.log("No plugins configured for status tracking.");
        }
        console.log("--------------------------------\n");
    }

    // --- Plugin and API Accessors ---
    get options() { return this._options; }
    get instance() { return this.bot; }
    get pathfinder() { return this.bot?.pathfinder; }
    get goals() { return this._goals; }
    get movements() { return this._movements; }
    get armorManager() { return this.bot?.armorManager; }
    get pvp() { return this.bot?.pvp; }
    get autoCrystal() { return this.bot?.autoCrystal; }
    get tool() { return this.bot?.tool; }
    get autoEat() { return this.bot?.autoEat; }
}

module.exports = MinimalBot;