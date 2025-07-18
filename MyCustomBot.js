// MyCustomBot.js

const { StateMachineBot, BOT_STATES } = require('./StateMachineBot.js');
const {
        pathfinder,
        goals,
        Movements,
      } = require("mineflayer-pathfinder");
const { mineflayer: mineflayerViewer } = require("prismarine-viewer");
/**
 * A helper function for creating a non-blocking delay.
 * @param {number} ms - The number of milliseconds to wait.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class MyCustomBot extends StateMachineBot {
    constructor(options, manager) {
        // Always call the parent constructor first!
        super(options, manager);

        this.mcData = require('minecraft-data')(this.options.version);
    }

    /**
     * Loading the plugins
     */
    _loadPlugins(){
        this.bot.loadPlugin(pathfinder);
        mineflayerViewer(this.bot,{
          port: 3000,firstPerson: false});
        return;
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
        console.log(`==================evaluating for ${this.bot.username} with ${message}`)
        
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
        console.log(`[${this.options.username}] Successfully connected to MAIN_SERVER. Starting tasks.`);
        this.bot.chat("Hello everyone! I am here to do important things.");

        try {
            // This loop will run as long as the bot is in the MAIN_SERVER state.
            while (this.state === BOT_STATES.MAIN_SERVER) {
                // --- YOUR TASK LOGIC GOES HERE ---
                // This is where you would do things like mine, build, or fight.
                // Even if your task takes a while, the 'await sleep' below will prevent blocking.
                
                this.bot.swingArm();
                console.log(`[${this.options.username}] Doing my main server task...`);
                
                // --- END OF TASK LOGIC ---

                // Wait for 10 seconds before the next loop iteration.
                // THIS IS THE MOST IMPORTANT PART. It yields control back to the event loop.
                await sleep(10000);
            }
        } catch (err) {
            console.error(`[${this.options.username}] Error in main server task loop:`, err);
        } finally {
            console.log(`[${this.options.username}] Exiting main server task loop as state has changed.`);
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

    // ! ////////////////////////// CAPTCHA METHODS //////////////////////////
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
}

module.exports = MyCustomBot;