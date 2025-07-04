const { Vec3 } = require('vec3');
const { GoalNear } = require('mineflayer-pathfinder').goals;
const ImageProcessor = require('../utils/ImageProcessor');

// Reverse mapping from item ID (e.g., 'white_carpet') to color name ('white')
const ID_TO_COLOR_NAME = {};
for (const color in ImageProcessor.COLOR_MAP) {
    ID_TO_COLOR_NAME[ImageProcessor.COLOR_MAP[color].id] = color.replace('_', ' ');
}

class Restocker {
    /**
     * @param {import('mineflayer').Bot} bot - The mineflayer bot instance.
     * @param {object} mcData - Minecraft data.
     * @param {object} mapArtOffsets - The map art configuration.
     */
    constructor(bot, mcData, mapArtOffsets) {
        this.bot = bot;
        this.mcData = mcData;
        this.mapArtOffsets = mapArtOffsets;
        this.mapArtOrigin = new Vec3(...mapArtOffsets.start);

        // --- Configuration for discarding items ---
        this.discardOffset = new Vec3(1, 0, 2); // 5 blocks away from the mapart corner
        this.discardPitch = -Math.PI / 4; // Look straight down
        this.discardYaw = -90;

        // Define the order of colors for restocking (based on chest positions)
        this.restockOrder = [
            'white',
            'light_gray',
            'gray', 
            'black',
            'brown',
            'red',
            'orange',
            'yellow',
            'lime',
            'green',
            'cyan',
            'light_blue',
            'blue',
            'purple',
            'magenta',
            'pink'
        ];
    }

    /**
     * Goes to a designated spot and throws away all items in the inventory.
     */
    async discardInventory() {
        console.log('Discarding inventory...');
        const discardPos = this.mapArtOrigin.plus(this.discardOffset);
        await this.bot.pathfinder.goto(new GoalNear(discardPos.x, discardPos.y, discardPos.z, 1));
        await this.bot.look(this.discardYaw, this.discardPitch, true);

        const itemsToToss = this.bot.inventory.items();
        if (itemsToToss.length === 0) {
            console.log('Inventory is already empty.');
            return;
        }

        for (const item of itemsToToss) {
            await this.bot.tossStack(item);
            await this.bot.waitForTicks(1); // Small delay to prevent server issues
        }
        console.log('Inventory discarded.');
    }

    /**
     * Gathers the required items from the storage chests.
     * @param {object} requiredItems - An object of item IDs and counts, e.g., { 'white_carpet': 64 }.
     * @returns {Promise<boolean>} - True if all items were successfully gathered, false otherwise.
     */
    async restock(requiredItems) {
        await this.discardInventory();
        console.log('Beginning restock process...');

        const needed = { ...requiredItems };
        let allItemsFound = true;

        // Restock in the predefined order
        for (const colorName of this.restockOrder) {
            const colorKey = colorName.replace(' ', '_');
            const itemId = ImageProcessor.COLOR_MAP[colorKey]?.id;
            
            if (!itemId || !needed[itemId]) {
                continue; // Skip if this color isn't needed
            }

            const amountNeeded = needed[itemId];
            if (amountNeeded <= 0) continue;

            const chestOffsetInfo = this.mapArtOffsets.offsets[colorKey];
            if (!chestOffsetInfo || chestOffsetInfo.length === 0) {
                console.error(`[Restocker] No chest offset defined for color: ${colorName}`);
                allItemsFound = false;
                continue;
            }

            const baseChestPos = this.mapArtOrigin.plus(new Vec3(...chestOffsetInfo[0]));
            let amountFound = 0;

            // Check up to 5 chests vertically
            for (let yOffset = 0; yOffset < 5; yOffset++) {
                if (amountFound >= amountNeeded) break;

                const chestPos = baseChestPos.plus(new Vec3(0, yOffset, 0));
                try {
                    const withdrawn = await this.withdrawFromChest(chestPos, itemId, amountNeeded - amountFound);
                    amountFound += withdrawn;
                } catch (err) {
                    // This is not a critical error if the chest is just empty, so we don't log an error.
                    // The error will be logged inside withdrawFromChest if it's a real problem.
                    break; 
                }
            }

            if (amountFound < amountNeeded) {
                console.error(`[Restocker] Failed to find enough ${colorName} carpet. Needed ${amountNeeded}, found ${amountFound}.`);
                allItemsFound = false;
            } else {
                console.log(`[Restocker] Successfully restocked ${amountFound} of ${colorName} carpet.`);
            }
        }
        
        console.log('Restock process finished.');
        return allItemsFound;
    }
    
    // --- REVISED LOGIC USING THE CORRECT METHOD ---
    async withdrawFromChest(chestPos, itemName, count) {
        const chestBlock = this.bot.blockAt(chestPos);
        if (!chestBlock || !chestBlock.name.includes('chest')) {
            throw new Error('No chest found at location.');
        }

        await this.bot.pathfinder.goto(new GoalNear(chestPos.x, chestPos.y, chestPos.z, 2));
        const chestWindow = await this.bot.openChest(chestBlock);

        const itemType = this.mcData.itemsByName[itemName];
        if (!itemType) {
            console.warn(`[Restocker] Unknown item name in mcData: ${itemName}`);
            await chestWindow.close();
            return 0;
        }

        let withdrawnCount = 0;
        // As per the user prompt, the chests are double chests (54 slots).
        const chestSlotCount = 54; 

        // Iterate over the chest slots only
        for (let i = 0; i < chestSlotCount && i < chestWindow.slots.length; i++) {
            const itemInSlot = chestWindow.slots[i];

            // Check if the slot has the item we need
            if (itemInSlot && itemInSlot.type === itemType.id) {
                const amountToTake = Math.min(
                    itemInSlot.count,       // How many are in this stack
                    count - withdrawnCount  // How many we still need
                );

                if (amountToTake > 0) {
                    await chestWindow.withdraw(itemType.id, null, amountToTake);
                    withdrawnCount += amountToTake;
                }

                // If we have enough, we can stop checking this chest
                if (withdrawnCount >= count) {
                    break;
                }
            }
        }
        
        await chestWindow.close();
        return withdrawnCount;
    }
}

module.exports = Restocker;