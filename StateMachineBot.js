// StateMachineBot.js

const mineflayer = require('mineflayer');

/**
 * Defines the possible states a bot can be in, inspired by your flowchart.
 */
const BOT_STATES = {
    DISCONNECTED: 'DISCONNECTED',
    CONNECTING: 'CONNECTING',
    EVALUATING: 'EVALUATING', // A temporary "freeze" state after spawning to determine location.
    LOBBY: 'LOBBY',
    MAIN_SERVER: 'MAIN_SERVER',
    BACKUP_SERVER: 'BACKUP_SERVER'
};

/**
 * An abstract class that provides a robust state machine for a Mineflayer bot.
 * It manages connection, disconnection, and state transitions based on server events.
 */
class StateMachineBot {
    /**
     * @param {object} options - Standard Mineflayer options (host, port, username, etc.).
     * @param {BotManager} manager - A reference to the BotManager instance.
     */
    constructor(options, manager) {
        this.options = options;
        this.manager = manager;
        this.bot = null;
        this.state = BOT_STATES.DISCONNECTED;
        this._isReconnecting = false;
        this.reconnectDelay = options.reconnectDelay || 15000; // Default to 15s
    }

    // --- Public API ---

    /**
     * Initiates the connection to the server.
     */
    connect() {
        if (this.state !== BOT_STATES.DISCONNECTED) return;
        
        this.transitionTo(BOT_STATES.CONNECTING);
        this.bot = mineflayer.createBot(this.options);
        this._attachEventListeners();
    }

    /**
     * Disconnects the bot from the server.
     * @param {string} reason - The reason for disconnection.
     */
    disconnect(reason = 'N/A') {
        if (this.state === BOT_STATES.DISCONNECTED) return;
        
        if (this.bot) {
            this.bot.quit(reason);
            this.bot.removeAllListeners(); // Prevent memory leaks
        }
        this.bot = null;
        this.transitionTo(BOT_STATES.DISCONNECTED);
    }

    /**
     * Called by the BotManager for a graceful shutdown. Prevents auto-reconnect.
     */
    shutdown() {
        this._isReconnecting = false; // Disable reconnect logic
        this.disconnect('Manager shutdown command');
    }


    // --- State Management ---

    /**
     * Handles the transition to a new state and calls the appropriate entry handler.
     * @param {string} newState - The state to transition to, from BOT_STATES.
     */
    transitionTo(newState) {
        if (this.state === newState) return;

        console.log(`[${this.options.username}] State Transition: ${this.state} -> ${newState}`);
        this.state = newState;

        // Automatically trigger the handler for the new state.
        // These are implemented by the child class.
        switch (newState) {
            case BOT_STATES.LOBBY:
                this._onEnterLobby();
                break;
            case BOT_STATES.MAIN_SERVER:
                this._onEnterMainServer();
                break;
            case BOT_STATES.BACKUP_SERVER:
                this._onEnterBackupServer();
                break;
        }
    }


    // --- Internal Event Handlers ---

    /**
     * Attaches all necessary Mineflayer event listeners to the bot instance.
     */
    _attachEventListeners() {
        this.bot.once('spawn', () => {
            console.log(`[${this.options.username}] Spawned. Freezing and evaluating current world...`);
            this._isReconnecting = false;
            this._loadPlugins(); //abstract
            // Enter the EVALUATING state to determine where we are.
            this.transitionTo(BOT_STATES.EVALUATING);
        });

        this.bot.on('message', (jsonMsg) => {
            // Only process messages if we are in the "freeze" state.
            if (this.state === BOT_STATES.EVALUATING || true) { // bypassed status check for being evaluating
                // Pass the raw message to the child class for interpretation.
                console.log(`==================evaluating for ${this.bot.username} with ${jsonMsg.toString()}`);
                this._evaluateLocation(jsonMsg.toString());
            }
        });

        this.bot.on('kicked', (reason) => {
            console.error(`[${this.options.username}] Kicked: ${reason}`);
            this.disconnect('kicked');
            this._handleDisconnection();
        });

        this.bot.on('end', (reason) => {
            if (this.state !== BOT_STATES.DISCONNECTED) {
                console.log(`[${this.options.username}] Connection ended. Reason: ${reason}`);
                this.disconnect('end');
                this._handleDisconnection();
            }
        });

        this.bot.on('error', (err) => {
            console.error(`[${this.options.username}] A bot error occurred:`, err.message);
        });
    }

    /**
     * Handles the auto-reconnect logic.
     */
    _handleDisconnection() {
        if (this._isReconnecting) return;

        this._isReconnecting = true;
        console.log(`[${this.options.username}] Will attempt to reconnect in ${this.reconnectDelay / 1000} seconds...`);
        
        setTimeout(() => {
            // Check if a manual shutdown was called during the timeout
            if (this._isReconnecting) {
                 this._isReconnecting = false;
                 this.connect();
            }
        }, this.reconnectDelay);
    }


    // --- Abstract Methods for Child Classes to Implement ---
    // This is the "contract" your custom bot class must fulfill.

    /**
     * REQUIRED: Implement this method to add plugins to bot.
     */
    _loadPlugins() {
        throw new Error("Child class must implement the _loadPlugins() method.");
    }

    /**
     * REQUIRED: Implement this method to determine the bot's location based on server messages.
     * Your logic here MUST call `this.transitionTo()` to move the bot out of the EVALUATING state.
     * @param {string} message - A chat message received from the server.
     */
    _evaluateLocation(message) {
        throw new Error("Child class must implement the _evaluateLocation() method.");
    }

    /**
     * REQUIRED: Implement this method with the logic to execute upon entering the Lobby.
     * Example: Solving a captcha, typing a password, or using a server selector.
     */
    _onEnterLobby() {
        throw new Error("Child class must implement the _onEnterLobby() method.");
    }

    /**
     * REQUIRED: Implement this method with the logic to execute upon entering the Main Server.
     * Example: Initializing tasks, starting a behavior loop, etc.
     */
    _onEnterMainServer() {
        throw new Error("Child class must implement the _onEnterMainServer() method.");
    }

    /**
     * REQUIRED: Implement this method with the logic to execute upon entering the Backup Server.
     * Example: Waiting and periodically trying to reconnect to the main server.
     */
    _onEnterBackupServer() {
        throw new Error("Child class must implement the _onEnterBackupServer() method.");
    }
}

// Export both the class and the states enum for use in other files.
module.exports = { StateMachineBot, BOT_STATES };