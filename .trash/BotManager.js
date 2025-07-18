// BotManager.js

const path = require('path');
const botConfigs = require('../config/bots.json'); // Assumes a config file exists

// IMPORTANT: You will change this line to import YOUR custom bot class.
const MyCustomBot = require('../MyCustomBot.js');

class BotManager {
    constructor() {
        this.bots = [];
    }

    /**
     * Initializes the manager and creates bot instances based on the configuration.
     */
    initialize() {
        console.log("Initializing Bot Manager...");

        if (!botConfigs || botConfigs.length === 0) {
            console.error("Error: No bot configurations found in config/bots.json. Exiting.");
            process.exit(1);
        }

        // Create a new bot instance for each configuration object.
        botConfigs.forEach((config) => {
            const botInstance = new MyCustomBot(config, this); // Pass config and a reference to the manager
            this.bots.push(botInstance);
        });

        console.log(`Loaded ${this.bots.length} bot(s). Ready to connect.`);
    }

    /**
     * Starts the connection process for all managed bots.
     */
    startAll() {
        if (this.bots.length === 0) {
            console.warn("No bots to start.");
            return;
        }
        console.log("Connecting all bots...");
        let connectInterval = 0;
        this.bots.forEach(bot => {
            setTimeout(()=>bot.connect(),connectInterval*5000);
            connectInterval++;
        });
    }

    /**
     * Shuts down all managed bots gracefully.
     */
    stopAll() {
        console.log("Shutting down all bots...");
        this.bots.forEach(bot => bot.shutdown());

        // Allow a moment for disconnection messages before exiting the process.
        setTimeout(() => process.exit(0), 2000);
    }
}

// --- Main Application Entry Point ---
const manager = new BotManager();

// Set up a graceful shutdown handler for CTRL+C.
process.on('SIGINT', () => {
    console.log("Caught interrupt signal. Shutting down gracefully.");
    manager.stopAll();
});

// Initialize and start the bots.
manager.initialize();
manager.startAll();

setTimeout(()=>{
    manager.stopAll();
},4000000);