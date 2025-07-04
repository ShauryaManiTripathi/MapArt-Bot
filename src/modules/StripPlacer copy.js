const { Vec3 } = require('vec3');
const { GoalNear, GoalBlock } = require('mineflayer-pathfinder').goals;

// A set of blocks that require sneaking to place another block on top of them.
const INTERACTABLE_BLOCKS = new Set([
    'chest', 'trapped_chest', 'ender_chest', 'barrel',
    'furnace', 'blast_furnace', 'smoker',
    'dispenser', 'dropper', 'hopper',
    'crafting_table', 'enchanting_table', 'anvil', 'chipped_anvil', 'damaged_anvil',
    'brewing_stand', 'beacon', 'note_block', 'jukebox', 'loom', 'cartography_table',
    'fletching_table', 'grindstone', 'smithing_table', 'stonecutter'
]);

// Helper function to check for interactable blocks, including shulker boxes by name.
function needsSneakToPlaceOn(block) {
    if (!block) return false;
    return INTERACTABLE_BLOCKS.has(block.name) || block.name.includes('shulker_box');
}

class StripPlacer {
    /**
     * @param {import('mineflayer').Bot} bot - The mineflayer bot instance.
     * @param {object} mcData - Minecraft data.
     * @param {object} mapArtOffsets - The map art configuration.
     * @param {import('../utils/ProgressManager')} progressManager - The progress manager instance.
     */
    constructor(bot, mcData, mapArtOffsets, progressManager) {
        this.bot = bot;
        this.mcData = mcData;
        this.mapArtOffsets = mapArtOffsets;
        this.progressManager = progressManager;
        this.mapArtOrigin = new Vec3(...mapArtOffsets.start);
        
        // World coordinates of the map art boundaries
        this.minBound = this.mapArtOrigin.plus(new Vec3(...mapArtOffsets.offsets.end));
        this.maxBound = this.mapArtOrigin;

        this.isPaused = false;
        this.isStopped = false;
    }

    pause() { this.isPaused = true; }
    continue() { this.isPaused = false; }
    stop() { this.isStopped = true; }

    /**
     * Generates a serpentine (snake-like) build order for efficiency.
     * @param {Array<object>} placements - The list of placements for the strip.
     * @returns {Array<object>} - The sorted list of placements.
     */
    _generateSerpentineOrder(placements) {
        // Group placements by their Z coordinate
        const rows = placements.reduce((acc, p) => {
            acc[p.x] = acc[p.x] || [];
            acc[p.x].push(p);
            return acc;
        }, {});

        // Sort rows by Z, then sort X within each row (alternating direction)
        const sortedRows = Object.keys(rows).sort((a, b) => a - b).map((z, index) => {
            if (index % 2 === 0) { // Even rows (0, 2, ...), sort X ascending
                return rows[z].sort((a, b) => a.x - b.x);
            } else { // Odd rows (1, 3, ...), sort X descending
                return rows[z].sort((a, b) => b.x - a.x);
            }
        });

        return [].concat(...sortedRows);
    }
    
    /**
     * Builds the currently active strip based on the progress file.
     * @returns {Promise<boolean>} True if the strip was completed, false if stopped.
     */
    async buildCurrentStrip() {
        this.isStopped = false;
        this.isPaused = false;
        const placements = this.progressManager.getPlacementsForCurrentStrip();
        if (placements.length === 0) {
            console.log('Current strip is already complete.');
            return true;
        }

        const orderedPlacements = this._generateSerpentineOrder(placements);
        console.log(`Starting to build strip. ${orderedPlacements.length} blocks to place.`);

        for (const placement of orderedPlacements) {
            while (this.isPaused && !this.isStopped) {
                await this.bot.waitForTicks(20);
            }
            if (this.isStopped) {
                console.log('Strip building stopped by command.');
                return false;
            }

            const targetPos = this.mapArtOrigin.offset(-placement.x, 0, -placement.z);
            const blockBelowPos = targetPos.offset(0, -1, 0);

            try {
                const safeStandPos = this.findSafeStandPos(targetPos);
                if (!safeStandPos) {
                    console.error(`Could not find a safe place to stand to build at ${targetPos}. Pausing.`);
                    this.isPaused = true;
                    continue;
                }
                
                await this.bot.pathfinder.goto(new GoalBlock(safeStandPos.x, safeStandPos.y, safeStandPos.z));
                await this.bot.lookAt(targetPos, true);

                const currentBlock = this.bot.blockAt(targetPos);
                const targetItem = this.mcData.itemsByName[placement.id];

                if (currentBlock && currentBlock.type === this.mcData.blocksByName[placement.id].id) {
                    await this.progressManager.updateBlockPlaced(placement.x, placement.z);
                    continue;
                }
                
                if (currentBlock && currentBlock.name !== 'air') {
                    await this.bot.dig(currentBlock, true);
                }

                await this.bot.equip(targetItem.id, 'hand');
                
                const referenceBlock = this.bot.blockAt(blockBelowPos);
                if (!referenceBlock) {
                    throw new Error(`Cannot place block, reference block at ${blockBelowPos} is missing/unloaded.`);
                }
                
                // --- SNEAK LOGIC IS HERE ---
                const shouldSneak = needsSneakToPlaceOn(referenceBlock);
                if (shouldSneak) {
                    this.bot.setControlState('sneak', true);
                }
                try {
                    await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
                } finally {
                    // This ensures we always stop sneaking, even if placeBlock fails
                    if (shouldSneak) {
                        this.bot.setControlState('sneak', false);
                    }
                }
                // --- END SNEAK LOGIC ---

                await this.progressManager.updateBlockPlaced(placement.x, placement.z);
                
            } catch (err) {
                console.error(`Error placing block at (${placement.x}, ${placement.z}): ${err.message}. Skipping for now.`);
                await this.bot.waitForTicks(20);
            }
        }

        console.log('Strip has been completed.');
        return true;
    }

    findSafeStandPos(targetPos) {
        const offsets = [
            new Vec3(0, 0, 1),
            new Vec3(0, 0, -1),
            new Vec3(1, 0, 0),
            new Vec3(-1, 0, 0)
        ];

        for (const offset of offsets) {
            const standPos = targetPos.plus(offset);
            if (standPos.x >= this.minBound.x && standPos.x <= this.maxBound.x &&
                standPos.z >= this.minBound.z && standPos.z <= this.maxBound.z) {
                    const footBlock = this.bot.blockAt(standPos);
                    const headBlock = this.bot.blockAt(standPos.offset(0, 1, 0));
                    if (footBlock && headBlock && (footBlock.boundingBox === 'empty' || footBlock.name.endsWith('_carpet')) && headBlock.boundingBox === 'empty') {
                         return standPos;
                    }
            }
        }
        return null;
    }
}

module.exports = StripPlacer;