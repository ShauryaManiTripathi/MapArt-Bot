const MapArtBot = require('./MapArtBot.js');
const DatabaseManager = require('./src/utils/DatabaseManager.js');

// This script is executed by the main `run.js` process for each bot.

(async () => {
    if (process.argv.length < 4) {
        console.error('Worker requires bot config and DB path as arguments.');
        process.exit(1);
    }
    // The bot's specific configuration is passed as a command-line argument
    const botConfig = JSON.parse(process.argv[2]);
    const dbPath = process.argv[3];

    console.log(`[Worker ${botConfig.username}] Starting...`);
    
    let botInstance;

    try {
        const db = new DatabaseManager(dbPath);
        await db.init();

        botInstance = new MapArtBot(botConfig, db);
        
        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log(`[Worker ${botConfig.username}] Received shutdown signal.`);
            if (botInstance) {
                botInstance.shutdown();
            }
            // Give the bot a moment to disconnect before exiting
            setTimeout(() => process.exit(0), 2000);
        });

    } catch (e) {
        console.error(`[Worker ${botConfig.username}] Fatal error on startup:`, e);
        process.exit(1);
    }
})();