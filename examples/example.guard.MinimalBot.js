const MinimalBot = require('../MinimalBot');

/**
 * GuardBot - An example of a bot that uses the pathfinder and viewer plugins.
 * It follows players who say "follow me" in chat.
 */
class GuardBot extends MinimalBot {
    constructor(options) {
        super(options);
    }

    /**
     * This is where we add our custom logic.
     * It's called automatically on spawn/respawn.
     */
    async initialize() {
        // This line is crucial for accessing parent methods if you override them.
        // await super.initialize(); 
        
        console.log("GuardBot initialization complete. Ready for commands.");

        // Make sure the pathfinder plugin was loaded before using it.
        if (this.pathfinder && this.movements) {
            const defaultMove = new this.movements(this.bot);
            
            this.bot.on('chat', (username, message) => {
                if (username === this.bot.username) return;

                if (message === 'follow me') {
                    const target = this.bot.players[username]?.entity;
                    if (!target) {
                        this.bot.chat("I can't see you, " + username);
                        return;
                    }
                    this.bot.chat("On my way!");
                    this.pathfinder.setMovements(defaultMove);
                    this.pathfinder.setGoal(new this.goals.GoalFollow(target, 3), true);
                }

                if (message === 'stop') {
                    this.bot.chat("Stopping.");
                    this.pathfinder.stop();
                }
            });
        } else {
            console.warn("Pathfinder plugin not enabled. 'follow me' command will not work.");
        }
    }
}

// --- Configuration and Execution ---

// Define the bot's connection details and which plugins to activate.
const botOptions = {
    host: 'shaurya43544-z1zg.aternos.me', // The target Minecraft server
    port: 48687,                         // The port of the target server
    username: 'GuardBot',
    auth: 'offline',

    // --- SOCKS5 Proxy Configuration ---
    // These settings will route the bot's connection through the specified proxy.
    proxyHost: '199.229.254.129', // The IP address of the proxy server.
    proxyPort: 4145,              // The port of the proxy server.
    proxyType: 5,                 // The version of the SOCKS proxy (5 for Socks5).
    // proxyUsername and proxyPassword can be added here if the proxy requires authentication.
    
    // Explicitly enable and configure plugins
    plugins: {
        pathfinder: true, // Enable the pathfinder
        viewer: {         // Enable and configure the viewer
            port: 3007,
            firstPerson: false
        }
    },
    
    // Reconnection settings
    autoReconnect: true,
    reconnectDelay: 5000,
    pluginsSuccessVerbose: true
};

// Create an instance of our custom GuardBot
const myBot = new GuardBot(botOptions);

// You can manually disconnect the bot like this:
// setTimeout(() => myBot.disconnect(), 60000); // Disconnect after 1 minute