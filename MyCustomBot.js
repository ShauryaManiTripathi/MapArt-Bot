// MyCustomBot.js

const { StateMachineBot, BOT_STATES } = require('./StateMachineBot.js');
const {
        pathfinder,
        goals,
        Movements,
      } = require("mineflayer-pathfinder");
const { mineflayer: mineflayerViewer } = require("prismarine-viewer");
const { Vec3 } = require('vec3');

const axios = require('axios');
const API_BASE_URL = 'http://localhost:4000';

/**
 * A helper function for creating a non-blocking delay.
 * @param {number} ms - The number of milliseconds to wait.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Color Maps
 */
const COLOR_MAP = {
    white: { r: 221, g: 221, b: 221, id: 'white_carpet' },
    light_gray: { r: 170, g: 170, b: 170, id: 'light_gray_carpet' },
    gray: { r: 85, g: 85, b: 85, id: 'gray_carpet' },
    black: { r: 25, g: 25, b: 25, id: 'black_carpet' },
    brown: { r: 136, g: 85, b: 51, id: 'brown_carpet' },
    red: { r: 170, g: 51, b: 51, id: 'red_carpet' },
    orange: { r: 221, g: 119, b: 51, id: 'orange_carpet' },
    yellow: { r: 238, g: 204, b: 51, id: 'yellow_carpet' },
    lime: { r: 119, g: 187, b: 51, id: 'lime_carpet' },
    green: { r: 85, g: 119, b: 51, id: 'green_carpet' },
    cyan: { r: 51, g: 136, b: 153, id: 'cyan_carpet' },
    light_blue: { r: 85, g: 153, b: 221, id: 'light_blue_carpet' },
    blue: { r: 51, g: 68, b: 170, id: 'blue_carpet' },
    purple: { r: 119, g: 51, b: 187, id: 'purple_carpet' },
    magenta: { r: 187, g: 68, b: 187, id: 'magenta_carpet' },
    pink: { r: 238, g: 136, b: 170, id: 'pink_carpet' },
};
// color index to color name map, u can do like COLOR_NAMES[i].append("_carpet") to get the name of object too
const COLOR_NAMES = Object.keys(COLOR_MAP);

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
    // Check if the block name is in our set OR if it's any color of shulker box.
    return INTERACTABLE_BLOCKS.has(block.name) || block.name.includes('shulker_box');
}


class MyCustomBot extends StateMachineBot {
    constructor(options, manager) {
        // Always call the parent constructor first!
        super(options, manager);
        this.cachedDiamondBlock = null;
        this.cachedEmeraldBlock = null;

        this.mcData = require('minecraft-data')(this.options.version);
    }

    /**
     * Loading the plugins
     */
    _loadPlugins(){
        this.bot.loadPlugin(pathfinder);
        // mineflayerViewer(this.bot,{
        //   port: 3000,firstPerson: false});
        // return;
    }

    /**
     * This is where you define how the bot knows where it is.
     * @param {string} message - The chat message from the server.
     */
    _evaluateLocation(message) {
        // Note: It's more efficient to define mcData once in the constructor
        // if the bot version doesn't change during runtime.
        const ironBlockId = this.mcData.blocksByName.iron_block.id;
        const netherPortalId = this.mcData.blocksByName.nether_portal.id;
        
        // Example logic:
        if (message.toLowerCase().includes(", please login with the command: /login <password>")) {
            this.transitionTo(BOT_STATES.LOBBY);
        } else if (message.toLowerCase().includes("welcome to 6b6t.org")) {
            this.transitionTo(BOT_STATES.MAIN_SERVER);
        } else if (message.toLowerCase().includes("server is full, sending you to backup")) {
            this.transitionTo(BOT_STATES.BACKUP_SERVER);
        }
    }

    /**
     * This code runs once the bot enters the LOBBY state.
     * We make it async to allow for non-blocking delays.
     */
    async _onEnterLobby() {
        console.log(`[${this.options.username}] Now in LOBBY. Attempting to log in.`);

        try {
            // Automatically type login command
            if (this.options.password) {
                this.bot.chat(`/login ${this.options.password}`);
            }

            // Wait for login to process
            await sleep(10000);

            // If the server is not 6b6t, we're done here.
            if (!this.options.host.includes("6b6t")) {
                console.log("Not on 6b6t, skipping captcha.");
                return;
            }

            // === CAPTCHA SOLVER LOGIC START ===
            console.log("=== Initiating Captcha Solver ===");

            // Configure movements specifically for the captcha
            let captchaMovements = new Movements(this.bot, this.mcData);
            captchaMovements.allowSprinting = true;
            captchaMovements.allowParkour = true;
            captchaMovements.canDig = false;
            this.bot.pathfinder.setMovements(captchaMovements);

            // Start the green wool pathing process and wait for it to complete
            await this.startGreenWoolPath();

            console.log("=== Captcha Solved (or finished path) ===");

            // Stop any residual pathfinder movement
            this.bot.pathfinder.stop();

            // Reset movements to default for general use after captcha
            this.bot.pathfinder.setMovements(new Movements(this.bot, this.mcData));
            // === CAPTCHA SOLVER LOGIC END ===

        } catch (err) {
            console.error(`[${this.options.username}] Error in _onEnterLobby:`, err);
        }
    }

    /**
     * This code runs once the bot enters the MAIN_SERVER state.
     * It now uses a non-blocking async loop for its tasks.
     */
    async _onEnterMainServer() {
        console.log(`[${this.options.username}] In MAIN_SERVER. Starting map art job loop.`);
        this.currentJob = null;
        let lastIdling = false;

        try {
            while (this.state === BOT_STATES.MAIN_SERVER) {
                if (!this.currentJob) {
                    this.currentJob = await this.requestJob();
                }

                if (this.currentJob) {
                    lastIdling = false;
                    const success = await this.executeJob(this.currentJob);
                    if (success) {
                        await this.reportJobComplete(this.currentJob);
                    } else {
                        // The job will time out and be reassigned automatically by the server.
                        console.log(`[${this.options.username}] Failed job ${this.currentJob.jobId}. It will be re-queued after timeout.`);
                    }
                    this.currentJob = null; // Clear job to request a new one
                } else {
                    // No jobs were available, wait before trying again.
                    console.log(`[${this.options.username}] No jobs available. Waiting...`);
                    if(lastIdling){await sleep(2500);}
                    else{
                        lastIdling=true;
                        await this.goIdle();
                    }
                    
                }
            }
        } catch (err) {
            console.error(`[${this.options.username}] Error in main server task loop:`, err);
        } finally {
            console.log(`[${this.options.username}] Exiting main server task loop.`);
        }
    }

    /**
     * This code runs once the bot enters the BACKUP_SERVER state.
     * This also uses the non-blocking async loop pattern.
     */
    async _onEnterBackupServer() {
        console.log(`[${this.options.username}] Connected to BACKUP_SERVER. Will periodically try to reconnect to main.`);

        try {
            // This loop will run as long as the bot is in the BACKUP_SERVER state.
            while (this.state === BOT_STATES.BACKUP_SERVER) {
                console.log(`[${this.options.username}] Trying to get back to the main server...`);
                this.bot.chat('/server main');

                // Wait for 1 minute before retrying.
                await sleep(60000);
            }
        } catch (err) {
            console.error(`[${this.options.username}] Error in backup server task loop:`, err);
        } finally {
            console.log(`[${this.options.username}] Exiting backup server task loop as state has changed.`);
        }
    }
    
    /**
     * Override disconnect. Since we are no longer using setInterval,
     * we don't need to clear anything. The async loops will stop automatically
     * when the state changes. We keep the override for potential future cleanup.
     */
    disconnect(reason) {
        console.log(`[${this.options.username}] Cleaning up custom tasks before disconnect.`);
        // Any other cleanup logic can go here.
        
        // Call the parent method to handle the actual disconnection
        super.disconnect(reason);
    }

    // ! ////////////////////////// onLobby Helpers //////////////////////////
    getGreenWoolPositions() {
        const range = 50;
        const greenWoolPositions = [];

        for (const entityId in this.bot.entities) {
            const entity = this.bot.entities[entityId];
            if (entity.type === "block_display" || entity.name === "block_display") {
                const translation = entity.metadata ?.[11] || { x: 0, y: 0, z: 0 };
                const scale = entity.metadata ?.[12] || { x: 1, y: 1, z: 1 };

                const visualPos = {
                    x: entity.position.x + (translation.x || 0) + 0.5 * (scale.x || 1),
                    y: entity.position.y + (translation.y || 0) + 0.5 * (scale.y || 1),
                    z: entity.position.z + (translation.z || 0) + 0.5 * (scale.z || 1),
                };

                const blockStateId = entity.metadata ?.[15] || entity.metadata ?.[23];
                let isGreenWool = false;

                if (blockStateId) {
                    try {
                        const blockState = this.mcData.blocksByStateId[blockStateId];
                        const blockName = blockState ? blockState.name : "";
                        isGreenWool = blockName.includes("green_wool");
                    } catch (e) { /* ignore */ }
                }

                if (isGreenWool) {
                    const playerPos = this.bot.entity.position;
                    if (
                        Math.abs(visualPos.x - playerPos.x) <= range &&
                        Math.abs(visualPos.z - playerPos.z) <= range
                    ) {
                        greenWoolPositions.push(visualPos);
                    }
                }
            }
        }

        return greenWoolPositions;
    }

    findNextGreenWool(currentPos, greenWoolPositions, visitedCoords) {
        let closestPos = null;
        let closestDistance = Infinity;
        for (const pos of greenWoolPositions) {
            const coordKey = `${Math.floor(pos.x)},${Math.floor(pos.z)}`;

            if (visitedCoords.has(coordKey)) continue;

            const distance = Math.sqrt(
                Math.pow(pos.x - currentPos.x, 2) + Math.pow(pos.z - currentPos.z, 2)
            );

            if (distance <= 2.5 && distance < closestDistance) {
                closestDistance = distance;
                closestPos = pos;
            }
        }
        return closestPos;
    }

    async moveToPositionEnhanced(targetPos, description = "target") {
        this.bot.swingArm("right");
        try {
            const goal = new goals.GoalBlock(
                Math.floor(targetPos.x),
                Math.floor(targetPos.y + 1), // Aim for head height to avoid getting stuck
                Math.floor(targetPos.z)
            );

            await this.bot.pathfinder.goto(goal);
            this.bot.swingArm("right");
        } catch (error) {
            console.log(`⚠️  Pathfinding to ${description} failed:`, error.message);
        }
    }

    async followGreenWoolPath() {
        let stepNumber = 1;
        let visitedCoords = new Set();
        const greenWoolPositions = this.getGreenWoolPositions();

        console.log(`Found ${greenWoolPositions.length} potential green wool blocks.`);

        while (stepNumber <= 50) { // Safety break after 50 steps
            const currentPos = this.bot.entity.position;
            const currentCoordKey = `${Math.floor(currentPos.x)},${Math.floor(currentPos.z)}`;
            visitedCoords.add(currentCoordKey);

            const nextPos = this.findNextGreenWool(currentPos, greenWoolPositions, visitedCoords);

            if (!nextPos) {
                console.log("No more green wool blocks found in range.");
                break;
            }
            
            console.log(`Step ${stepNumber}: Moving to next green wool.`);
            await this.moveToPositionEnhanced(nextPos, "green wool");
            stepNumber++;
        }

        console.log("Finished following wool path. Moving to final portal position.");
        const portalPos = { x: -1001, y: 101, z: -988 };
        try {
            const goal = new goals.GoalBlock(portalPos.x, portalPos.y, portalPos.z);
            await this.bot.pathfinder.goto(goal);
        } catch (error) {
            console.error("Failed to pathfind to the final portal:", error.message);
        }
    }

    async startGreenWoolPath() {
        // Initial movement to align with the path
        const currentPos = this.bot.entity.position.clone();
        const initialTarget = currentPos.offset(0, 0, 1.5);
        await this.moveToPositionEnhanced(initialTarget, "initial position");
        
        // Follow the main path
        await this.followGreenWoolPath();
    }
    // ! /////////////////////////////////////////////////////////////////////

    // ! ////////////////////////// onMainServer Helpers ////////////////////////////////
    /**
     * Requests a job from the central API server.
     */
    async requestJob() {
        try {
            console.log(`[${this.options.username}] Requesting a job...`);
            const response = await axios.post(`${API_BASE_URL}/api/jobs/request`, {
                botId: this.bot.username
            });

            if (response.data && response.data.jobId) {
                console.log(`[${this.options.username}] Received job: ${response.data.type}`);
                return response.data;
            }
            return null;
        } catch (error) {
            console.error(`[${this.options.username}] Could not request job:`, error.message);
            return null;
        }
    }
     /**
     * Executes the logic for the received job.
     * @param {object} job The job object from the server.
     * @returns {boolean} True if successful, false otherwise.
     */
    async executeJob(job) {
        console.log(`[${this.options.username}] Executing job ${job.jobId} of type ${job.type}`);
        if (job.type === 'BUILD_SEGMENT') {
            // TODO: Implement the logic to build the 32x16 area.
            // You have `job.colorData` (a 2D array of color indexes)
            // and `job.segmentCoords` (the relative position within the 128x128 chunk).
            // You will need to calculate the absolute world coordinates.

            this.bot.chat(`Building segment ${job.segmentCoords.x}, ${job.segmentCoords.y}`);

            const restockInfo = await this.startRestock(job);
            if(!restockInfo){
                console.log(`[${this.options.username}] Restock info gathering failure!`)
                return false;
            }

            const restockSuccess = await this.performRestock(restockInfo);
            if(!restockSuccess){
                console.log(`[${this.options.username}] Restocking failure!`);
                return false;
            }

            console.log(`[${this.options.username}] Materials confirmed. Starting printer build process...`);

            const buildSuccess = await this.buildSegment(job, restockInfo);

            return buildSuccess;

        } else if (job.type === 'SAVE_MAP') {
            // Implement the map saving algorithm
            this.bot.chat(`I am now saving the map for chunk ${job.chunkCoords.x}, ${job.chunkCoords.y}`);
            
            try {
                // Step 1: Search for a diamond block anywhere and go stand on top of it
                const diamondBlock = await this.findAndGoToDiamondBlock();
                if (!diamondBlock) {
                    console.log(`[${this.options.username}] No diamond block found!`);
                    return false;
                }

                // Step 2: Search for a barrel, take out map and glass pane
                const mapAndPane = await this.getMapAndGlassPaneFromBarrel();
                if (!mapAndPane) {
                    console.log(`[${this.options.username}] Could not get map and glass pane from barrel!`);
                    return false;
                }

                // Step 3: Hold map in hotbar and right click it
                await this.activateMap();

                // Step 4: Search for cartography table and lock the map
                const lockingSuccess = await this.lockMapAtCartographyTable();
                if (!lockingSuccess) {
                    console.log(`[${this.options.username}] Failed to lock map at cartography table!`);
                    return false;
                }

                // Step 5: Search for nearest chest and put the locked map into it
                const chestSuccess = await this.putMapInChest();
                if (!chestSuccess) {
                    console.log(`[${this.options.username}] Failed to put map in chest!`);
                    return false;
                }

                // Step 6: Flush Old Map
                const buttonSuccess = await this.flushOldMap();
                if (!buttonSuccess) {
                    console.log(`[${this.options.username}] Failed to press the completion button!`);
                    return false; // Fail the entire job if the button press fails.
                }

                console.log(`[${this.options.username}] Successfully completed map saving algorithm!`);
                return true;

            } catch (error) {
                console.error(`[${this.options.username}] Error in map saving algorithm:`, error);
                return false;
            }
        }
        return false;
    }

    /**
     * Reports a job as successfully completed to the API server.
     * @param {object} job The job object.
     */
    async reportJobComplete(job) {
        try {
            await axios.post(`${API_BASE_URL}/api/jobs/complete`, {
                jobId: job.jobId,
                jobType: job.type
            });
            console.log(`[${this.options.username}] Successfully reported completion for job ${job.jobId}.`);
        } catch (error) {
            console.error(`[${this.options.username}] Could not report job completion:`, error.message);
        }
    }
    // ! ////////////////////////////////////////////////////////////////////////////////

    // ! /////////////////////////////////  executeJob Helper - IDLE  ////////////////////////////////////////

    async goIdle(){
            const diamondBlockId = this.mcData.blocksByName.diamond_block.id;

    // The old, inefficient loop is replaced by this single, efficient line:
    const diamondBlock = this.bot.findBlock({
        matching: diamondBlockId,
        maxDistance: 128 // Search radius
    });
    
    if (!diamondBlock) {
        console.error(`[${this.options.username}] Could not find a diamond block within range.`);
        return null;
    }
    
    // The rest of the logic remains the same.
    const targetPos = diamondBlock.position.offset(((Math.random()-0.5)*10), 1,-55+((Math.random()-0.5)*6));
    const goal = new goals.GoalBlock(targetPos.x, targetPos.y, targetPos.z);
    try {
        await this.bot.pathfinder.goto(goal);
        console.log(`[${this.options.username}] Standing on diamond block at ${diamondBlock.position}`);
        return diamondBlock;
    } catch (error) {
        console.error(`[${this.options.username}] Failed to reach diamond block:`, error);
        return null;
    }
    }

    // ! /////////////////////////////////  executeJob Helper - RESTOCK  ////////////////////////////////////////
    /**
     * Calculates required materials, finds the primary restock station, determines the layout (case),
     * and maps all chest locations.
     * @param {object} job - The job object from the server.
     * @returns {Promise<object|null>} A comprehensive object with all required locations and materials, or null on failure.
     */
    async startRestock(job) {
        // Step 1: Calculate required items.
        const requiredItems = new Map();
        for (const row of job.colorData) {
            for (const colorIndex of row) {
                const itemName = `${COLOR_NAMES[colorIndex]}_carpet`;
                requiredItems.set(itemName, (requiredItems.get(itemName) || 0) + 1);
            }
        }

        // Step 2: Find the emerald block.
        // --- NEW CACHING LOGIC ---
        // Find a new emerald block, but also check if it's better than our cached one.
        console.log(`[${this.options.username}] Searching for nearest restock station...`);
        const nearestEmerald = this.bot.findBlock({
            matching: this.mcData.blocksByName.emerald_block.id,
            maxDistance: 128
        });

        if (!nearestEmerald && !this.cachedEmeraldBlock) {
             console.error(`[${this.options.username}] CRITICAL: No restock station found and none in cache.`);
             return null;
        }

        // If we found a new block and it's closer than our cache (or if we have no cache), update the cache.
        if (nearestEmerald && (!this.cachedEmeraldBlock || this.bot.entity.position.distanceTo(nearestEmerald.position) < this.bot.entity.position.distanceTo(this.cachedEmeraldBlock.position))) {
            console.log(`[${this.options.username}] Found new or closer restock station. Updating cache.`);
            this.cachedEmeraldBlock = nearestEmerald;
        }
        
        const emeraldBlock = this.cachedEmeraldBlock; // Use the best one we know of.

        const emeraldPos = emeraldBlock.position;
        console.log(`[${this.options.username}] Found restock station at ${emeraldPos}.`);

        // Step 3: Determine the case and the corresponding discard location.
        let discardLocation = null;
        const posCase1 = emeraldPos.offset(-2, -2, 0);
        const posCase2 = emeraldPos.offset(2, -2, 0);

        if (this.bot.blockAt(posCase1)?.name === 'cobblestone') {
            console.log(`[${this.options.username}] Restock station Case 1 detected.`);
            discardLocation = {
                standPos: emeraldPos.offset(-2, -1, 0),
                lookPos: emeraldPos.offset(0, -1, 0)
            };
        } else if (this.bot.blockAt(posCase2)?.name === 'cobblestone') {
            console.log(`[${this.options.username}] Restock station Case 2 detected.`);
            discardLocation = {
                standPos: emeraldPos.offset(2, -1, 0),
                lookPos: emeraldPos.offset(0, -1, 0)
            };
        }

        if (!discardLocation) {
            console.error(`[${this.options.username}] Found emerald block, but could not determine case (no cobblestone marker).`);
            return null;
        }

        // Step 4: Scan for and map all chest locations.
        const chestLocations = new Map();
        for (let zOffset = -8; zOffset <= 8; zOffset++) {
            const carpetPos = emeraldPos.offset(0, 0, zOffset);
            const carpetBlock = this.bot.blockAt(carpetPos);
            // Check if the block is a carpet by checking if its name ends with '_carpet'
            if (carpetBlock?.name.endsWith('_carpet')) {

                let chestPos = null;
                if(this.bot.blockAt(posCase1)?.name === 'cobblestone')
                    chestPos = carpetPos.offset(-1, -1, 0);
                else
                    chestPos = carpetPos.offset(1, -1, 0);

                if (this.bot.blockAt(chestPos)?.name.includes('chest')) {
                    // Map the item name (e.g., 'white_carpet') to its chest's position.
                    chestLocations.set(carpetBlock.name, chestPos);
                }
            }
        }
        if (chestLocations.size < 16) {
             console.warn(`[${this.options.username}] Warning: Found only ${chestLocations.size}/16 chest locations.`);
        } else {
            console.log(`[${this.options.username}] Successfully mapped all ${chestLocations.size} chest locations.`);
        }

        // Step 5: Return all discovered information.
        return {
            requiredItems,
            discardLocation,
            chestLocations,
            emeraldBlock
        };
    }
    /**
     * Takes the discovered restock information and executes the discard and gather operations.
     * @param {object} restockInfo - The comprehensive object from startRestock.
     * @returns {Promise<boolean>} - True if all required items were successfully acquired.
     */
    async performRestock(restockInfo) {
        const { requiredItems, discardLocation, chestLocations } = restockInfo;

        // --- Step 1: Smart Discard ---
        console.log(`[${this.options.username}] Moving to discard location to clear inventory.`);
        await this.bot.pathfinder.goto(new goals.GoalBlock(discardLocation.standPos.x, discardLocation.standPos.y, discardLocation.standPos.z));
        await this.bot.lookAt(discardLocation.lookPos, true);

        for (const item of this.bot.inventory.items()) {
            const amountRequired = requiredItems.get(item.name) || 0;
            if (amountRequired === 0) {
                // Not needed at all, toss the whole stack.
                await this.bot.tossStack(item);
            } else if (item.count > amountRequired) {
                // Have more than needed, toss the excess.
                const excess = item.count - amountRequired;
                await this.bot.toss(item.type, null, excess);
            }
            await sleep(100); // Small delay between tosses
        }
        console.log(`[${this.options.username}] Smart discard finished.`);

        // --- Step 2: Calculate final list of needed items ---
        const needed = new Map();
        for (const [itemName, totalAmount] of requiredItems.entries()) {
            const currentAmount = this.bot.inventory.count(this.mcData.itemsByName[itemName].id, null);
            if (currentAmount < totalAmount) {
                needed.set(itemName, totalAmount - currentAmount);
            }
        }

        if (needed.size === 0) {
            console.log(`[${this.options.username}] All items already in inventory after discard. Restock complete.`);
            return true;
        }
        console.log(`[${this.options.username}] Now gathering needed items:`, needed);
        
        // --- Step 3: Go to each required chest and withdraw items ---
        for (const [itemName, amountToGet] of needed.entries()) {
            const chestPos = chestLocations.get(itemName);
            if (!chestPos) {
                console.error(`[${this.options.username}] CRITICAL: Mapped chest location for ${itemName} is missing!`);
                return false; // Cannot continue if a chest is not mapped.
            }

            try {
                // The beauty of pathfinding: Go NEAR the chest.
                console.log(`[${this.options.username}] Pathfinding to chest for ${itemName}...`);
                await this.bot.pathfinder.goto(new goals.GoalNear(chestPos.x, chestPos.y, chestPos.z, 2));

                const chestBlock = this.bot.blockAt(chestPos);
                const chestWindow = await this.bot.openChest(chestBlock);

                console.log(`[${this.options.username}] Withdrawing ${amountToGet} of ${itemName}...`);
                await chestWindow.withdraw(this.mcData.itemsByName[itemName].id, null, amountToGet);
                await chestWindow.close();
            } catch (err) {
                console.error(`[${this.options.username}] Failed to withdraw ${itemName}: ${err.message}`);
                // If any chest interaction fails, the whole restock fails.
                return false;
            }
        }
        
        // --- Step 4: Final verification ---
        const stillNeeded = new Map();
        for (const [itemName, totalAmount] of requiredItems.entries()) {
            const finalAmount = this.bot.inventory.count(this.mcData.itemsByName[itemName].id, null);
            if (finalAmount < totalAmount) {
                stillNeeded.set(itemName, totalAmount - finalAmount);
            }
        }

        if (stillNeeded.size > 0) {
            console.error(`[${this.options.username}] Restock failed. Still missing items:`, stillNeeded);
            return false;
        }

        console.log(`[${this.options.username}] Restock successful. All materials acquired.`);
        return true;
    }
    // ! ////////////////////////// executeJob Helper - BUILD_SEGMENT (Intelligent Printer) //////////////////

    /**
     * The main entry point for the "Intelligent Printer" style build job.
     * @param {object} job - The job object from the server.
     * @returns {Promise<boolean>} - True only if the segment is built and verified successfully.
     */
    async buildSegment(job) {
        console.log(`[${this.options.username}] Locating map art origin (diamond block) for placement...`);

        // --- NEW DIAMOND BLOCK CACHING ---
        if (!this.cachedDiamondBlock) {
            console.log(`[${this.options.username}] Locating map art origin (diamond block) for the first time...`);
            this.cachedDiamondBlock = this.bot.findBlock({
                matching: this.mcData.blocksByName.diamond_block.id,
                maxDistance: 256
            });
            if (this.cachedDiamondBlock) {
                 console.log(`[${this.options.username}] Map art origin cached at ${this.cachedDiamondBlock.position}.`);
            }
        }
        if (!this.cachedDiamondBlock) {
            console.error(`[${this.options.username}] CRITICAL: Could not find map art origin.`);
            return false;
        }
        // --- END DIAMOND BLOCK CACHING ---

        const mapArtOrigin = this.cachedDiamondBlock.position.offset(-64, 1, -64);
        const allPlacements = this.getPlacementsForSegment(job, mapArtOrigin);
        if (allPlacements.length === 0) return true;

        // --- NEW CHUNK PRE-LOADING STEP ---
        const firstBlockPos = allPlacements[0].pos;
        console.log(`[${this.options.username}] Moving to job area at ${firstBlockPos} to load chunks...`);
        await this.bot.pathfinder.goto(new goals.GoalNear(firstBlockPos.x, firstBlockPos.y, firstBlockPos.z, 32));
        console.log(`[${this.options.username}] Arrived at job area. Starting build.`);
        // --- END CHUNK PRE-LOADING ---

        
        const segmentBounds = this.getSegmentBounds(allPlacements);
        const completedPlacements = new Set();
        
        console.log(`[${this.options.username}] Starting intelligent printer build for ${allPlacements.length} blocks.`);

        while (completedPlacements.size < allPlacements.length) {
            let actionsInCycle = 0;
            const botPos = this.bot.entity.position;

            // Step 1: Scan for all reachable, incorrect blocks from the current position.
            const reachableErrors = this.findReachableIncorrectBlocks(allPlacements, completedPlacements, botPos);

            // Step 2: Fix all of them rapidly.
            if (reachableErrors.length > 0) {
                console.log(`[${this.options.username}] Found ${reachableErrors.length} reachable blocks to fix.`);
                for (const placement of reachableErrors) {
                    const success = await this.fixSingleBlock(placement);
                    if (success) {
                        completedPlacements.add(placement.pos.toString());
                        actionsInCycle++;
                    }
                }
            }

            // If we took action, loop again to see if our fixes revealed new reachable blocks.
            if (actionsInCycle > 0) {
                await this.bot.waitForTicks(2);
                continue;
            }

            // Step 3: If we can't fix anything, we need to move.
            const nearestTodo = this.findNearestTodoBlock(allPlacements, completedPlacements, botPos);
            if (nearestTodo) {
                const standPos = this.findSmartStandPos(nearestTodo, segmentBounds);
                if (standPos) {
                    console.log(`[${this.options.username}] Moving to smart stand position at ${standPos}...`);
                    try {
                        await this.bot.pathfinder.goto(new goals.GoalBlock(standPos.x, standPos.y, standPos.z));
                    } catch(err) { /* The loop will just try finding a new spot */ }
                } else {
                    console.error(`[${this.options.username}] Cannot find a valid standing position to continue. Aborting.`);
                    return false;
                }
            } else {
                // No more blocks to do, exit the loop.
                break;
            }
        }
        
        // console.log(`[${this.options.username}] Build loop complete. Performing final verification...`);
        // return this.verifySegmentIsCorrect(allPlacements);

        /**
         * All below is alternative to above commented two lines
         */

        // --- NEW: Final Verification & Repair Loop ---
        console.log(`[${this.options.username}] Build loop complete. Starting final verification and repair cycle...`);
        let verificationAttempts = 0;
        while (verificationAttempts < 5) { // Safety break to prevent infinite loops
            const failedBlocks = this.verifySegmentAndGetErrors(allPlacements);

            if (failedBlocks.length === 0) {
                console.log(`[${this.options.username}] Final verification passed. Segment is complete.`);
                return true; // SUCCESS!
            }
            
            console.log(`[${this.options.username}] Verification found ${failedBlocks.length} incorrect blocks. Starting final repairs...`);
            verificationAttempts++;

            // Fix all the blocks that were found to be incorrect
            for(const placement of failedBlocks) {
                const standPos = this.findSmartStandPos(placement, segmentBounds);
                if (standPos) {
                    try {
                        await this.bot.pathfinder.goto(new goals.GoalBlock(standPos.x, standPos.y, standPos.z));
                        await this.fixSingleBlock(placement);
                    } catch(err) {
                        console.warn(`[${this.options.username}] Pathfinder failed during final repair. Will re-verify.`);
                    }
                } else {
                    console.error(`[${this.options.username}] Cannot find standing position for final repair at ${placement.pos}. Aborting.`);
                    return false;
                }
            }
        }
        
        console.error(`[${this.options.username}] Failed to complete segment after 5 verification attempts. Aborting job.`);
        return false;
    }

    /**
     * Converts the 2D colorData array into a list of placement objects.
     */
    getPlacementsForSegment(job, mapArtOrigin) {
        const placements = [];
        const segmentStartX = job.segmentCoords.x * 32;
        const segmentStartZ = job.segmentCoords.y * 16;
        for (let zOffset = 0; zOffset < job.colorData.length; zOffset++) {
            for (let xOffset = 0; xOffset < job.colorData[zOffset].length; xOffset++) {
                const colorIndex = job.colorData[zOffset][xOffset];
                const itemName = `${COLOR_NAMES[colorIndex]}_carpet`;
                const blockPos = mapArtOrigin.offset(segmentStartX + xOffset, 0, segmentStartZ + zOffset);
                placements.push({ pos: blockPos, itemName });
            }
        }
        return placements;
    }

    /**
     * Calculates the min/max X and Z coordinates for the current job segment.
     */
    getSegmentBounds(allPlacements) {
        return {
            minX: Math.min(...allPlacements.map(p => p.pos.x)),
            maxX: Math.max(...allPlacements.map(p => p.pos.x)),
            minZ: Math.min(...allPlacements.map(p => p.pos.z)),
            maxZ: Math.max(...allPlacements.map(p => p.pos.z))
        };
    }

    /**
     * Finds ALL reachable blocks that do not match the schematic.
     */
    findReachableIncorrectBlocks(allPlacements, completed, botPos) {
        const reachable = [];
        for (const placement of allPlacements) {
            if (completed.has(placement.pos.toString())) continue;
            const currentBlock = this.bot.blockAt(placement.pos);
            const targetId = this.mcData.blocksByName[placement.itemName].id;
            if (currentBlock?.type !== targetId && botPos.distanceTo(placement.pos) <= 4.5) {
                reachable.push(placement);
            } else if (currentBlock?.type === targetId) {
                // Optimization: if we scan a correct block, mark it as completed.
                completed.add(placement.pos.toString());
            }
        }
        return reachable;
    }

    /**
     * Finds the single nearest un-completed block to pathfind towards.
     */
    findNearestTodoBlock(allPlacements, completed, botPos) {
        let nearest = null;
        let nearestDistance = Infinity;
        for (const placement of allPlacements) {
            if (completed.has(placement.pos.toString())) continue;
            const distance = botPos.distanceTo(placement.pos);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = placement;
            }
        }
        return nearest;
    }
    
    /**
     * The new core of smart movement. Finds a valid spot to stand based on your rules.
     */
    findSmartStandPos(targetPlacement, segmentBounds) {
        const targetPos = targetPlacement.pos;
        for (let radius = 1; radius <= 4; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;

                    const standPos = targetPos.offset(dx, 0, dz);
                    if (standPos.distanceTo(targetPos) > 5.5) continue;

                    const headPos = standPos.offset(0, 1, 0);
                    const groundPos = standPos.offset(0, -1, 0);
                    
                    const headBlock = this.bot.blockAt(headPos);
                    const standBlock = this.bot.blockAt(standPos);
                    const groundBlock = this.bot.blockAt(groundPos);
                    
                    if (!groundBlock || groundBlock.boundingBox !== 'block' || headBlock?.boundingBox !== 'empty') continue;

                    const isInsideArea = (
                        standPos.x >= segmentBounds.minX && standPos.x <= segmentBounds.maxX &&
                        standPos.z >= segmentBounds.minZ && standPos.z <= segmentBounds.maxZ
                    );

                    if (isInsideArea) {
                        if (standBlock?.name.endsWith('_carpet')) return standPos;
                    } else {
                        if (standBlock?.boundingBox === 'empty' || standBlock?.name.endsWith('_carpet') || standBlock?.name.endsWith('_sign')) {
                            return standPos;
                        }
                    }
                }
            }
        }
        return null;
    }

    /**
     * The core action function. Assumes the bot is already in position.
     */
    async fixSingleBlock(placement) {
        let isSneaking = false;
        try {
            const currentBlock = this.bot.blockAt(placement.pos);
            if (currentBlock && currentBlock.name !== 'air') {
                await this.bot.dig(currentBlock, true);
            }
            const targetItem = this.mcData.itemsByName[placement.itemName];
            await this.bot.equip(targetItem.id, 'hand');
            await sleep(30);
            if (this.bot.heldItem?.type !== targetItem.id) throw new Error(`Failed to equip`);
            const referenceBlock = this.bot.blockAt(placement.pos.offset(0, -1, 0));
            if (!referenceBlock) throw new Error("Reference block is missing.");
            if (referenceBlock.name === 'dispenser') {
                this.bot.setControlState('sneak', true);
                isSneaking = true;
            }
            this.bot._client.write('block_place', {
                location: referenceBlock.position, direction: 1, hand: 0,
                cursorX: 0.5, cursorY: 1.0, cursorZ: 0.5, insideBlock: false
            });
            await sleep(30);
            return true;
        } catch (err) {
            console.log(`[${this.options.username}] `,err)
            return false;
        } finally {
            if (isSneaking) this.bot.setControlState('sneak', false);
        }
    }

    /**
     * The final check. Iterates through the whole area one last time.
     */
    verifySegmentIsCorrect(allPlacements) {
        let errorsFound = 0;
        for (const placement of allPlacements) {
            const block = this.bot.blockAt(placement.pos);
            const targetId = this.mcData.blocksByName[placement.itemName].id;
            if (block?.type !== targetId) {
                errorsFound++;
            }
        }
        if (errorsFound > 0) {
            console.error(`[${this.options.username}] Build failed final verification with ${errorsFound} errors.`);
            return false;
        }
        return true;
    }

        /**
     * The final check. Iterates through the whole area and returns a list of errors.
     * @returns {Array<object>} - An array of placement objects that are incorrect. An empty array means success.
     */
    verifySegmentAndGetErrors(allPlacements) {
        const errorsFound = [];
        for (const placement of allPlacements) {
            const block = this.bot.blockAt(placement.pos);
            const targetId = this.mcData.blocksByName[placement.itemName].id;
            if (block?.type !== targetId) {
                errorsFound.push(placement);
            }
        }
        return errorsFound;
    }

    // ! /////////////////////////////////  executeJob Helper - SAVEMAP  ////////////////////////////////////////

/**
 * Step 1: Find a diamond block and go stand on top of it
 */
async findAndGoToDiamondBlock() {
    console.log(`[${this.options.username}] Searching for diamond block...`);
    
    // --- NEW DIAMOND BLOCK CACHING ---
        if (!this.cachedDiamondBlock) {
            console.log(`[${this.options.username}] Locating map art origin (diamond block) for the first time...`);
            this.cachedDiamondBlock = this.bot.findBlock({
                matching: this.mcData.blocksByName.diamond_block.id,
                maxDistance: 256
            });
            if (this.cachedDiamondBlock) {
                 console.log(`[${this.options.username}] Map art origin cached at ${this.cachedDiamondBlock.position}.`);
            }
        }
        if (!this.cachedDiamondBlock) {
            console.error(`[${this.options.username}] CRITICAL: Could not find map art origin.`);
            return false;
        }
        // --- END DIAMOND BLOCK CACHING ---

    
    // The rest of the logic remains the same.
    const targetPos = this.cachedDiamondBlock.position.offset(0, 1, 0);
    const goal = new goals.GoalBlock(targetPos.x, targetPos.y, targetPos.z);
    
    try {
        await this.bot.pathfinder.goto(goal);
        console.log(`[${this.options.username}] Standing on diamond block at ${this.cachedDiamondBlock.position}`);
        return this.cachedDiamondBlock;
    } catch (error) {
        console.error(`[${this.options.username}] Failed to reach diamond block:`, error);
        return null;
    }
}

/**
 * Step 2: Find a barrel and take out map and glass pane
 */
async getMapAndGlassPaneFromBarrel() {
    console.log(`[${this.options.username}] Searching for barrel...`);
    
    const barrelId = this.mcData.blocksByName.barrel.id;

    const barrel = this.bot.findBlock({
        matching: barrelId,
        maxDistance: 50
    });
    
    if (!barrel) {
        console.log(`[${this.options.username}] No barrel found!`);
        return null;
    }
    
    try {
        // Open the barrel
        const barrelContainer = await this.bot.openContainer(barrel);
        await sleep(500); // Wait for container to open
        
        // Look for map and glass pane
        const mapItem = this.mcData.itemsByName.map || this.mcData.itemsByName.empty_map;
        const glassPaneItem = this.mcData.itemsByName.glass_pane;
        
        let foundMap = false;
        let foundGlassPane = false;
        
        // Take map from barrel
        const mapSlot = barrelContainer.containerItems().find(item => 
            item && (item.type === mapItem.id)
        );
        
        if (mapSlot) {
            await barrelContainer.withdraw(mapSlot.type, null, 1);
            foundMap = true;
            console.log(`[${this.options.username}] Took map from barrel`);
        }
        
        // Take glass pane from barrel
        const glassPaneSlot = barrelContainer.containerItems().find(item => 
            item && item.type === glassPaneItem.id
        );
        
        if (glassPaneSlot) {
            await barrelContainer.withdraw(glassPaneSlot.type, null, 1);
            foundGlassPane = true;
            console.log(`[${this.options.username}] Took glass pane from barrel`);
        }
        
        // Close the barrel
        await barrelContainer.close();
        
        return foundMap && foundGlassPane;
        
    } catch (error) {
        console.error(`[${this.options.username}] Error accessing barrel:`, error);
        return null;
    }
}

/**
 * Step 3: Hold map in hotbar and right click it
 */
async activateMap() {
    console.log(`[${this.options.username}] Activating map...`);
    
    const mapItem = this.mcData.itemsByName.map || this.mcData.itemsByName.empty_map;
    
    // Find map in inventory
    const mapSlot = this.bot.inventory.findInventoryItem(mapItem.id);
    
    if (!mapSlot) {
        console.log(`[${this.options.username}] Map not found in inventory!`);
        return false;
    }
    
    try {
        // Equip the map to hotbar
        await this.bot.equip(mapItem.id, 'hand');
        await sleep(500);
        
        // Right click (activate) the map
        this.bot.activateItem();
        await sleep(1000);
        
        console.log(`[${this.options.username}] Map activated successfully`);
        return true;
        
    } catch (error) {
        console.error(`[${this.options.username}] Error activating map:`, error);
        return false;
    }
}

/**
 * Step 4: Find cartography table and lock the map
 */
async lockMapAtCartographyTable() {
    console.log(`[${this.options.username}] Searching for cartography table...`);
    
    const cartographyTableId = this.mcData.blocksByName.cartography_table.id;
    
    // Find cartography table
    const cartographyTable = this.bot.findBlock({
        matching: cartographyTableId,
        maxDistance: 50
    });
    
    if (!cartographyTable) {
        console.log(`[${this.options.username}] No cartography table found!`);
        return false;
    }
    
    try {
        // Change 1: Use openBlock for reliability, as it directly returns the window.
        const window = await this.bot.openBlock(cartographyTable);
        
        // Get item IDs
        const filledMapId = this.mcData.itemsByName.filled_map.id;
        const glassPaneId = this.mcData.itemsByName.glass_pane.id;
        
        // Change 2: Use the simpler deposit method. This is the main fix for your error.
        // It tells Mineflayer "find a filled_map and deposit it", which is more robust.
        await window.deposit(filledMapId, null, 1);
        await sleep(1000); // Wait after depositing
        
        await window.deposit(glassPaneId, null, 1);
        await sleep(1000);
        
        // Change 3: Add a longer, crucial delay here.
        // We must wait for the server to process the recipe and send us the "set slot" packet
        // for the output slot. 3 seconds is a safe bet for most servers.
        console.log(`[${this.options.username}] Items deposited. Waiting for server to craft locked map...`);
        await sleep(3000);
        
        // Change 4: Add a safety check, just like the example code.
        // Before we try to take the item, make SURE it's there. The output is slot 2.
        const outputSlot = window.slots[2];
        if (outputSlot?.type !== filledMapId) {
            console.error(`[${this.options.username}] Error: Locked map did not appear in the output slot!`);
            await window.close();
            return false;
        }

        console.log(`[${this.options.username}] Locked map appeared. Taking it now.`);
        
        // Now it's safe to take the result.
        await window.withdraw(outputSlot.type, null, outputSlot.count,outputSlot.nbt);
        
        
        await window.close();
        console.log(`[${this.options.username}] Successfully locked map and closed window.`);
        return true;
        
    } catch (error) {
        // The catch block is more robust now.
        console.error(`[${this.options.username}] A critical error occurred using the cartography table:`, error.message);
        if (this.bot.currentWindow) {
            await this.bot.closeWindow(this.bot.currentWindow);
        }
        return false;
    }
}

/**
 * Step 5: Find nearest chest and put the locked map into it
 */
async putMapInChest() {
    console.log(`[${this.options.username}] Searching for nearest chest...`);
    
    const chestId = this.mcData.blocksByName.chest.id;

    const nearestChest = this.bot.findBlock({
        matching: chestId,
        maxDistance: 50
    });
    
    if (!nearestChest) {
        console.log(`[${this.options.username}] No chest found!`);
        return false;
    }
    
    try {
        // Move to chest
        const chestPos = nearestChest.position;
        // const goal = new goals.GoalBlock(chestPos.x, chestPos.y, chestPos.z);
        // await this.bot.pathfinder.goto(goal);
        
        // Open the chest
        const chestContainer = await this.bot.openContainer(nearestChest);
        await sleep(500);
        
        // Put the locked map into the chest
        const mapItem = this.mcData.itemsByName.filled_map || this.mcData.itemsByName.map;
        
        // Find the map in inventory (should be the locked one now)
        const lockedMap = this.bot.inventory.findInventoryItem(mapItem.id);
        
        if (lockedMap) {
            await chestContainer.deposit(mapItem.id, null, 1);
            console.log(`[${this.options.username}] Locked map deposited in chest`);
        }
        
        // Close the chest
        await chestContainer.close();
        
        return true;
        
    } catch (error) {
        console.error(`[${this.options.username}] Error accessing chest:`, error);
        return false;
    }
}

/**
 * Step 6: Find and press a nearby oak button to signal completion.
 */
async flushOldMap() {
    console.log(`[${this.options.username}] Searching for a nearby oak button...`);

    const oakButtonId = this.mcData.blocksByName.oak_button.id;
    const searchRadius = 10; // The button should be close.

    // Use the efficient findBlock method.
    const button = this.bot.findBlock({
        matching: oakButtonId,
        maxDistance: searchRadius
    });

    if (!button) {
        console.error(`[${this.options.username}] No oak button found within ${searchRadius} blocks.`);
        return false; // Indicate failure
    }

    try {
        console.log(`[${this.options.username}] Found oak button at ${button.position}. Pressing it.`);
        // Activating the block is all that's needed to press it.
        await this.bot.activateBlock(button);
        await this.goIdle();
        await sleep(3000); // Keep it flushing, we can begin now
        console.log(`[${this.options.username}] Successfully pressed the oak button.`);
        return true; // Indicate success
    } catch (error) {
        console.error(`[${this.options.username}] Failed to press the oak button:`, error.message);
        return false;
    }
}


    // ! ////////////////////////////////////////////////////////////////////////////////


}

module.exports = MyCustomBot;