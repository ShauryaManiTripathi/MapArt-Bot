const MinimalBot = require('../MinimalBot');

class ChestInspectorBot extends MinimalBot {
    constructor(options) {
        const requiredOptions = {
            ...options,
            plugins: {
                ...options.plugins,
                pathfinder: true,
            }
        };
        super(requiredOptions);
    }

    async initialize() {
        await super.initialize();
        
        console.log("ChestInspectorBot initialization complete. Ready for commands.");

        if (!this.pathfinder || !this.movements || !this.goals) {
            console.error("Pathfinder plugin not enabled or failed to load. 'inspect chest' command will not work.");
            return;
        }

        this.bot.on('chat', async (username, message) => {
            if (username === this.bot.username) return;

            if (message.trim().toLowerCase() === 'inspect chest') {
                await this.findAndInspectClosestChest(username);
            }
        });
    }

    async findAndInspectClosestChest(requester) {
        this.bot.chat(`Alright ${requester}, I'm looking for the nearest chest.`);

        const chestIds = [
            this.bot.registry.blocksByName.chest.id,
            this.bot.registry.blocksByName.trapped_chest.id
        ];

        const chestBlock = this.bot.findBlock({
            matching: (block) => chestIds.includes(block.type),
            maxDistance: 64
        });

        if (!chestBlock) {
            this.bot.chat("Sorry, I couldn't find any chests nearby.");
            console.log("No chest found within range.");
            return;
        }

        const chestPosition = chestBlock.position;
        this.bot.chat(`Found a chest at ${chestPosition}. On my way!`);
        console.log(`Found a chest at ${chestPosition}. Pathfinding...`);

        try {
            const goal = new this.goals.GoalNear(chestPosition.x, chestPosition.y, chestPosition.z, 1);
            await this.pathfinder.goto(goal);

            console.log("Arrived at chest. Opening...");
            const chestWindow = await this.bot.openChest(chestBlock);
            this.bot.chat("Opened the chest. Loading contents...");

            // IMPROVED: Better waiting strategy
            await this.waitForWindowToLoad(chestWindow);
            
            // Additional safety: wait a bit more and check again
            await this.sleep(500);
            
            // Get chest items correctly - manually extract from slots
            const chestItems = this.getChestItems(chestWindow);
            
            // Debug logging
            console.log(`Window type: ${chestWindow.type}`);
            console.log(`Window slots count: ${chestWindow.slots.length}`);
            console.log(`Chest items found: ${chestItems.length}`);
            
            console.log("\n--- Chest Contents ---");
            if (chestItems.length === 0) {
                console.log("The chest is empty.");
                this.bot.chat("This chest is empty.");
            } else {
                this.bot.chat(`Found ${chestItems.length} item(s) in the chest!`);
                const itemTable = chestItems.map(item => ({
                    'Item': item.displayName,
                    'Count': item.count,
                    'Slot': item.slot
                }));
                console.table(itemTable);
                
                // Also show a summary in chat
                const itemSummary = {};
                chestItems.forEach(item => {
                    if (itemSummary[item.displayName]) {
                        itemSummary[item.displayName] += item.count;
                    } else {
                        itemSummary[item.displayName] = item.count;
                    }
                });
                
                console.log("\n--- Item Summary ---");
                Object.entries(itemSummary).forEach(([name, count]) => {
                    console.log(`${name}: ${count} total`);
                });
            }
            console.log("----------------------\n");

            await chestWindow.close();
            console.log("Chest window closed.");

        } catch (err) {
            console.error("An error occurred while trying to inspect the chest:", err.message);
            console.error("Full error:", err);
            this.bot.chat("Something went wrong, I couldn't inspect the chest.");
        }
    }

    /**
     * Extract chest items from the window slots
     * For a double chest (generic_9x6), slots 0-53 are chest contents, 54-89 are player inventory
     * For a single chest (generic_9x3), slots 0-26 are chest contents, 27-62 are player inventory
     */
    getChestItems(chestWindow) {
        const items = [];
        let chestSlotCount;
        
        // Determine how many slots belong to the chest based on window type
        switch (chestWindow.type) {
            case 'minecraft:generic_9x3': // Single chest
                chestSlotCount = 27;
                break;
            case 'minecraft:generic_9x6': // Double chest
                chestSlotCount = 54;
                break;
            case 'minecraft:generic_9x1': // Hopper
                chestSlotCount = 5;
                break;
            case 'minecraft:generic_9x2': // Some modded chests
                chestSlotCount = 18;
                break;
            default:
                // Fallback: assume it's a single chest
                chestSlotCount = 27;
                console.log(`Unknown chest type: ${chestWindow.type}, assuming single chest`);
        }
        
        // Extract items from chest slots only
        for (let i = 0; i < chestSlotCount && i < chestWindow.slots.length; i++) {
            const slot = chestWindow.slots[i];
            if (slot) { // slot exists and has an item
                items.push({
                    ...slot,
                    slot: i // Add slot index for reference
                });
            }
        }
        
        return items;
    }

    /**
     * Improved window loading wait function
     */
    waitForWindowToLoad(window) {
        return new Promise((resolve) => {
            let updateCount = 0;
            let hasResolved = false;
            
            const onUpdate = (slot, oldItem, newItem) => {
                updateCount++;
                console.log(`Slot update #${updateCount}: slot ${slot}, ${oldItem ? oldItem.displayName : 'empty'} -> ${newItem ? newItem.displayName : 'empty'}`);
            };
            
            window.on('updateSlot', onUpdate);
            
            // Wait for either multiple updates or a reasonable timeout
            const checkComplete = () => {
                if (hasResolved) return;
                
                // If we've received some updates, wait a bit more for any additional ones
                if (updateCount > 0) {
                    setTimeout(() => {
                        if (!hasResolved) {
                            hasResolved = true;
                            window.removeListener('updateSlot', onUpdate);
                            console.log(`Window loaded with ${updateCount} slot updates`);
                            resolve();
                        }
                    }, 500);
                } else {
                    // No updates yet, wait longer
                    setTimeout(checkComplete, 100);
                }
            };
            
            // Start checking after a short delay
            setTimeout(checkComplete, 100);
            
            // Ultimate fallback timeout
            setTimeout(() => {
                if (!hasResolved) {
                    hasResolved = true;
                    window.removeListener('updateSlot', onUpdate);
                    console.log(`Window load timeout reached. Updates received: ${updateCount}`);
                    resolve();
                }
            }, 3000);
        });
    }

    /**
     * Helper function for delays
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = ChestInspectorBot;


// --- Configuration and Execution ---

// Define the bot's connection details and which plugins to activate.
const botOptions = {
    host: 'shaurya43544-z1zg.aternos.me', // The target Minecraft server IP or hostname
    port: 48687,                // The port of the target server
    username: 'ChestInspector', // The desired username for the bot
    auth: 'offline',            // Use 'mojang' or 'microsoft' for online-mode servers

    // --- Optional Proxy Configuration ---
    // proxyHost: '199.229.254.129',
    // proxyPort: 4145,
    // proxyType: 5,
    
    // You can enable other plugins here as well.
    // The ChestInspectorBot class will automatically ensure 'pathfinder' is enabled.
    plugins: {
        viewer: {
            port: 3008,         // Different port from the GuardBot example
            firstPerson: false
        },
        autoEat: true // Let's add auto-eat for convenience
    },
    
    // Reconnection settings from MinimalBot
    autoReconnect: true,
    reconnectDelay: 5000,
    pluginsSuccessVerbose: true
};

// Create an instance of our custom ChestInspectorBot
console.log("Starting ChestInspectorBot...");
console.log("Once in-game, type 'inspect chest' in the chat to command the bot.");
const myBot = new ChestInspectorBot(botOptions);

// You can still add listeners here for debugging or other simple tasks
myBot.bot?.on('error', (err) => console.log("Caught an error from the bot instance:", err));