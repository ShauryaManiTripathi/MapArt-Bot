const path = require('path');
const { fork } = require('child_process'); // Import the 'fork' method
const botConfigs = require('./config/bots.json');

class BotManager {
    constructor() {
        // Use a Map to store references to the child processes, keyed by username.
        this.childBots = new Map();
    }

    /**
     * Initializes the manager and forks a new process for each bot configuration.
     */
    initialize() {
        console.log("Initializing Bot Manager...");

        if (!botConfigs || botConfigs.length === 0) {
            console.error("Error: No bot configurations found in config/bots.json. Exiting.");
            process.exit(1);
        }

        let connectInterval = 0;

        botConfigs.forEach((config) => {
            console.log(`Forking process for bot: ${config.username}`);

            // Fork the worker script.
            const child = fork(path.resolve(__dirname, 'bot_worker.js'));

            // Send the configuration to the newly forked process.
            setTimeout(()=>{connectInterval++;child.send({ type: 'init', payload: { config } });},connectInterval*5000);

            // Store the child process for later management.
            this.childBots.set(config.username, child);

            // Handle the child process exiting.
            child.on('exit', (code) => {
                console.log(`Bot process for ${config.username} has exited with code ${code}.`);
                this.childBots.delete(config.username);
            });

             // Listen for any messages from the child (optional, but good for debugging)
             child.on('message', (msg) => {
                console.log(`Message from ${config.username}:`, msg);
            });
        });

        console.log(`Forked ${this.childBots.size} bot process(es). Ready to connect.`);
    }

    /**
     * Starts the connection process for all managed bots by sending a 'start' command.
     */
    startAll() {
        if (this.childBots.size === 0) {
            console.warn("No bot processes to start.");
            return;
        }

        console.log("Sending 'start' command to all bot processes...");
        
        let connectInterval = 0;
        this.childBots.forEach(child => {
            // Stagger the start commands to avoid all bots connecting at the exact same moment.
            setTimeout(() => {
                child.send({ type: 'command', payload: { command: 'start' } });
            }, connectInterval * 5000);
            connectInterval++;
        });
    }

    /**
     * Shuts down all managed bots gracefully by sending a 'stop' command.
     */
    stopAll() {
        console.log("Sending 'stop' command to all bot processes...");
        this.childBots.forEach(child => {
            child.send({ type: 'command', payload: { command: 'stop' } });
        });

        // Allow a moment for disconnection messages before exiting the main process.
        setTimeout(() => process.exit(0), 5000);
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

// The main process no longer needs to self-destruct.
// It will exit when all child processes have terminated.
// setTimeout(()=>{
//     manager.stopAll();
// },4000000);