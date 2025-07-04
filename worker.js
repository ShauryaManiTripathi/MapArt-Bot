const MapArtBot = require('./MapArtBot.js');
const DatabaseManager = require('./src/utils/DatabaseManager.js');

// This script is executed by the main `run.js` process for each bot.

(async () => {
    if (process.argv.length < 6) {
        console.error('Worker requires bot config, DB path, bot index, and total bots as arguments.');
        process.exit(1);
    }
    // Arguments are passed from the main `run.js` process
    const botConfig = JSON.parse(process.argv[2]);
    const dbPath = process.argv[3];
    const botIndex = parseInt(process.argv[4], 10);
    const totalBots = parseInt(process.argv[5], 10);


    console.log(`[Worker ${botConfig.username}] Starting with index ${botIndex}/${totalBots}...`);
    
    let botInstance;

    try {
        const db = new DatabaseManager(dbPath);
        await db.init();

        botInstance = new MapArtBot(botConfig, db, botIndex, totalBots);
        
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