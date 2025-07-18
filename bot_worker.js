const MyCustomBot = require('./MyCustomBot.js');

let bot = null;

/**
 * Handles messages sent from the parent BotManager process.
 * @param {object} message - The message object from the parent.
 */
process.on('message', (message) => {
    const { type, payload } = message;

    switch (type) {
        case 'init':
            // The manager is providing the config for this bot.
            // We pass null for the manager reference as it doesn't exist in this process.
            bot = new MyCustomBot(payload.config, null);
            console.log(`[Worker for ${payload.config.username}] Initialized.`);
            break;

        case 'command':
            // The manager is sending a command.
            handleCommand(payload.command);
            break;
    }
});

/**
 * Executes a command on the bot instance.
 * @param {string} command - The command to execute ('start' or 'stop').
 */
function handleCommand(command) {
    if (!bot) {
        console.error("Bot has not been initialized. Cannot execute command.");
        return;
    }

    switch (command) {
        case 'start':
            console.log(`[Worker for ${bot.options.username}] Received start command.`);
            bot.connect();
            break;

        case 'stop':
            console.log(`[Worker for ${bot.options.username}] Received stop command.`);
            bot.shutdown();
            // Allow time for graceful disconnect before exiting the process.
            setTimeout(() => process.exit(0), 1500);
            break;
    }
}

// Handle unexpected crashes in the bot process
process.on('uncaughtException', (err) => {
    console.error(`[Worker] Uncaught Exception:`, err);
    // If the bot exists, try to log which one crashed.
    if (bot && bot.options) {
        console.error(`This error originated from bot: ${bot.options.username}`);
    }
    process.exit(1); // Exit with an error code
});