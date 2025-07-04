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
     * Groups placements into 2-row batches for efficient building.
     * @param {Array<object>} placements - The list of placements for the strip.
     * @returns {Array<Array<object>>} - Array of batches, each containing 2 rows of placements.
     */
    _groupIntoFourRowBatches(placements) {
        // Group placements by their X coordinate (rows)
        const rows = placements.reduce((acc, p) => {
            acc[p.x] = acc[p.x] || [];
            acc[p.x].push(p);
            return acc;
        }, {});

        // Sort rows by X coordinate and group them into pairs
        const sortedRowKeys = Object.keys(rows).sort((a, b) => a - b);
        const batches = [];

        for (let i = 0; i < sortedRowKeys.length; i += 4) {
            const batch = [];
            
            // Add first row
            const firstRow = rows[sortedRowKeys[i]].sort((a, b) => a.z - b.z);
            batch.push(...firstRow);
            
            // Add second row if it exists
            if (i + 1 < sortedRowKeys.length) {
                const secondRow = rows[sortedRowKeys[i + 1]].sort((a, b) => a.z - b.z);
                batch.push(...secondRow);
            }

            if (i + 2 < sortedRowKeys.length) {
                const secondRow = rows[sortedRowKeys[i + 2]].sort((a, b) => a.z - b.z);
                batch.push(...secondRow);
            }

            if (i + 3 < sortedRowKeys.length) {
                const secondRow = rows[sortedRowKeys[i + 3]].sort((a, b) => a.z - b.z);
                batch.push(...secondRow);
            }
            
            batches.push(batch);
        }

        return batches;
    }

    /**
     * Finds a safe standing position that can reach all blocks in a 2-row batch.
     * @param {Array<object>} batch - The batch of placements to build.
     * @returns {Vec3|null} - The safe standing position or null if none found.
     */
    findSafeStandPosForBatch(batch) {
        if (batch.length === 0) return null;

        // Find the bounds of the batch
        const minX = Math.min(...batch.map(p => p.x));
        const maxX = Math.max(...batch.map(p => p.x));
        const minZ = Math.min(...batch.map(p => p.z));
        const maxZ = Math.max(...batch.map(p => p.z));

        // Convert to world coordinates
        const minWorldX = this.mapArtOrigin.x - maxX;
        const maxWorldX = this.mapArtOrigin.x - minX;
        const minWorldZ = this.mapArtOrigin.z - maxZ;
        const maxWorldZ = this.mapArtOrigin.z - minZ;

        // Candidate positions around the batch area
        const candidates = [];
        
        // North and south of the batch (Z +/- 1)
        for (let x = minWorldX - 1; x <= maxWorldX + 1; x++) {
            candidates.push(new Vec3(x, this.mapArtOrigin.y, minWorldZ - 1)); // North
            candidates.push(new Vec3(x, this.mapArtOrigin.y, maxWorldZ + 1)); // South
        }
        
        // East and west of the batch (X +/- 1)
        for (let z = minWorldZ - 1; z <= maxWorldZ + 1; z++) {
            candidates.push(new Vec3(minWorldX - 1, this.mapArtOrigin.y, z)); // West
            candidates.push(new Vec3(maxWorldX + 1, this.mapArtOrigin.y, z)); // East
        }

        // Test each candidate position
        for (const candidate of candidates) {
            // Check if position is within bounds
            if (candidate.x >= this.minBound.x && candidate.x <= this.maxBound.x &&
                candidate.z >= this.minBound.z && candidate.z <= this.maxBound.z) {
                
                const footBlock = this.bot.blockAt(candidate);
                const headBlock = this.bot.blockAt(candidate.offset(0, 1, 0));
                
                // Check if position is safe to stand
                if (footBlock && headBlock && 
                    (footBlock.boundingBox === 'empty' || footBlock.name.endsWith('_carpet')) && 
                    headBlock.boundingBox === 'empty') {
                    
                    // Check if all blocks in batch are reachable (within 4.5 blocks)
                    let allReachable = true;
                    for (const placement of batch) {
                        const targetPos = this.mapArtOrigin.offset(-placement.x, 0, -placement.z);
                        const distance = candidate.distanceTo(targetPos);
                        if (distance > 4.5) {
                            allReachable = false;
                            break;
                        }
                    }
                    
                    if (allReachable) {
                        return candidate;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Places all blocks in a batch from the given standing position.
     * @param {Array<object>} batch - The batch of placements to build.
     * @param {Vec3} standPos - The position to stand at while building.
     * @returns {Promise<void>}
     */
    async placeBatchFromPosition(batch, standPos) {
        // Move to the standing position
        await this.bot.pathfinder.goto(new GoalBlock(standPos.x, standPos.y, standPos.z));
        
// Replace the block placement section in placeBatchFromPosition method
// Around line 160-200, replace the try-catch block with this:

// Place all blocks in the batch
for (const placement of batch) {
    while (this.isPaused && !this.isStopped) {
        await this.bot.waitForTicks(20);
    }
    if (this.isStopped) {
        return;
    }

    const targetPos = this.mapArtOrigin.offset(-placement.x, 0, -placement.z);
    const blockBelowPos = targetPos.offset(0, -1, 0);

    // Retry logic for each block
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
        try {
            await this.bot.lookAt(targetPos, true);

            const currentBlock = this.bot.blockAt(targetPos);
            const targetItem = this.mcData.itemsByName[placement.id];

            // Skip if block is already correct
            if (currentBlock && currentBlock.type === this.mcData.blocksByName[placement.id].id) {
                await this.progressManager.updateBlockPlaced(placement.x, placement.z);
                break; // Exit retry loop
            }
            
            // Dig existing block if needed
            if (currentBlock && currentBlock.name !== 'air') {
                await this.bot.dig(currentBlock, true);
            }

            // Ensure we have the item and equip it
            if (!this.bot.inventory.findInventoryItem(targetItem.id)) {
                throw new Error(`Missing item ${placement.id} in inventory`);
            }
            await this.bot.equip(targetItem.id, 'hand');
            
            // Double check item is equipped
            if (!this.bot.heldItem || this.bot.heldItem.type !== targetItem.id) {
                throw new Error(`Failed to equip ${placement.id}`);
            }
            
            const referenceBlock = this.bot.blockAt(blockBelowPos);
            if (!referenceBlock) {
                throw new Error(`Cannot place block, reference block at ${blockBelowPos} is missing/unloaded.`);
            }
            
            // --- SNEAK LOGIC ---
            const shouldSneak = needsSneakToPlaceOn(referenceBlock);
            if (shouldSneak) {
                this.bot.setControlState('sneak', true);
            }
            try {
                // Use shorter timeout for block placement
                await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
            } finally {
                if (shouldSneak) {
                    this.bot.setControlState('sneak', false);
                }
            }
            // --- END SNEAK LOGIC ---

            await this.progressManager.updateBlockPlaced(placement.x, placement.z);
            break; // Success, exit retry loop
            
        } catch (err) {
            retryCount++;
            console.error(`Error placing block at (${placement.x}, ${placement.z}), attempt ${retryCount}/${maxRetries}: ${err.message}`);
            
            if (retryCount < maxRetries) {
                console.log(`Retrying block placement at (${placement.x}, ${placement.z})...`);
                await this.bot.waitForTicks(10); // Short wait before retry
            } else {
                console.error(`Failed to place block at (${placement.x}, ${placement.z}) after ${maxRetries} attempts. Skipping.`);
            }
        }
    }
}
    }
    
    /**
     * Builds the currently active strip using optimized 2-row batching.
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

        const batches = this._groupIntoFourRowBatches(placements);
        console.log(`Starting to build strip with ${batches.length} batches (${placements.length} blocks total).`);

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            console.log(`Processing batch ${i + 1}/${batches.length} with ${batch.length} blocks.`);
            
            while (this.isPaused && !this.isStopped) {
                await this.bot.waitForTicks(20);
            }
            if (this.isStopped) {
                console.log('Strip building stopped by command.');
                return false;
            }

            const standPos = this.findSafeStandPosForBatch(batch);
            if (!standPos) {
                console.error(`Could not find a safe standing position for batch ${i + 1}. Falling back to individual placement.`);
                // Fallback to placing blocks individually
                for (const placement of batch) {
                    const targetPos = this.mapArtOrigin.offset(-placement.x, 0, -placement.z);
                    const safePos = this.findSafeStandPos(targetPos);
                    if (safePos) {
                        await this.placeBatchFromPosition([placement], safePos);
                    }
                }
                continue;
            }

            await this.placeBatchFromPosition(batch, standPos);
        }

        console.log('Strip has been completed.');
        return true;
    }

    /**
     * Fallback method for finding safe position for individual blocks.
     * @param {Vec3} targetPos - The target position to place a block.
     * @returns {Vec3|null} - Safe standing position or null.
     */
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