const { Command } = require('commander');
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

const botConfigs = require('./config/bots.json');
const mapArtOffsets = require('./config/mapart_offsets.js');
const ImageProcessor = require('./src/utils/ImageProcessor.js');
const DatabaseManager = require('./src/utils/DatabaseManager.js');

const program = new Command();
const DB_PATH = path.join(process.cwd(), 'mapart.sqlite');
const WORKER_PATH = path.join(__dirname, 'worker.js');

let childProcesses = [];

// Graceful shutdown
function shutdown() {
    console.log('Shutting down bot processes...');
    childProcesses.forEach(child => {
        child.kill('SIGINT');
    });
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- Bot Spawner ---
async function launchBots() {
    if (!fs.existsSync(WORKER_PATH)) {
        console.error(`Error: Worker script not found at ${WORKER_PATH}`);
        return;
    }

    const totalBots = botConfigs.length;
    if (totalBots === 0) {
        console.error("No bots defined in config/bots.json. Aborting.");
        return;
    }

    console.log(`Launching ${totalBots} bot(s)...`);
    botConfigs.forEach((botConfig, index) => {
        const child = fork(WORKER_PATH, [
            JSON.stringify(botConfig), 
            DB_PATH, 
            index.toString(),          // Pass bot's index
            totalBots.toString()       // Pass total number of bots
        ], {
            stdio: 'inherit'
        });
        childProcesses.push(child);
    });
}

// --- CLI Definitions ---

program
    .name('mapart-cli')
    .description('CLI to control the multi-bot map art project.');

program
    .command('start')
    .description('Starts a new map art project. Clears any existing project.')
    .argument('<image_source>', 'URL or local file name in ./assets for the image')
    .option('-d, --dither <algorithm>', 'Dithering algorithm to use', 'floydSteinberg')
    .action(async (imageSource, options) => {
        console.log('Starting new map art project...');
        const db = new DatabaseManager(DB_PATH);
        await db.init();

        const validAlgorithms = ['floydSteinberg', 'jarvisJudiceNinke', 'stucki', 'atkinson', 'sierra', 'burkes'];
        if (!validAlgorithms.includes(options.dither)) {
            console.error(`Invalid dithering algorithm: "${options.dither}".`);
            console.error(`Valid options are: ${validAlgorithms.join(', ')}`);
            return;
        }

        console.log(`Processing image: ${imageSource} with ${options.dither} dithering...`);
        const imageData = await ImageProcessor.processImage(imageSource, options.dither);

        if (!imageData) {
            console.error('Failed to process image. Aborting.');
            return;
        }

        await db.startNewMapArt(imageSource, options.dither, imageData, mapArtOffsets.width);
        console.log('Project created successfully in the database.');
        
        await launchBots();
    });

program
    .command('continue')
    .description('Resumes a paused project and launches the bots.')
    .action(async () => {
        const db = new DatabaseManager(DB_PATH);
        await db.init();
        
        const project = await db.getProjectState();
        if (!project || !project.is_active) {
            console.log('No active project to continue. Use "start" to begin a new one.');
            return;
        }

        if (!project.is_paused) {
            console.log('Project is already running.');
        } else {
            await db.setPaused(false);
            console.log('Project resumed.');
        }

        await launchBots();
    });

program
    .command('pause')
    .description('Pauses the current project. Does not stop the bot processes.')
    .action(async () => {
        const db = new DatabaseManager(DB_PATH);
        await db.init();
        await db.setPaused(true);
        console.log('Pause command sent. Bots will idle on their next check.');
    });

program
    .command('clear')
    .description('Stops any running bots and completely clears the project progress.')
    .action(async () => {
        shutdown(); // Kills any running child processes first
        const db = new DatabaseManager(DB_PATH);
        await db.init();
        await db.clearProject();
        console.log('Project progress has been cleared from the database.');
    });

program
    .command('status')
    .description('Displays the status of the current map art project.')
    .action(async () => {
        const db = new DatabaseManager(DB_PATH);
        await db.init();
        const stats = await db.getCompletionStats();

        if (!stats.project) {
            console.log('No active project found.');
            return;
        }

        const percentage = ((stats.placed_blocks / stats.total_blocks) * 100).toFixed(2);

        console.log('\n--- Map Art Status ---');
        console.log(`  Project Active: ${stats.project.is_active ? 'Yes' : 'No'}`);
        console.log(`  Project Paused: ${stats.project.is_paused ? 'Yes' : 'No'}`);
        console.log(`  Image Source:   ${stats.project.image_source}`);
        console.log(`  Dithering:      ${stats.project.dithering_algorithm}`);
        console.log('\n--- Progress ---');
        console.log(`  Overall:        ${percentage}% complete`);
        console.log(`  Blocks:         ${stats.placed_blocks} / ${stats.total_blocks}`);
        console.log(`  Strips:         ${stats.completed_strips} / ${stats.total_strips} completed`);
        console.log(`                  ${stats.assigned_strips} assigned, ${stats.pending_strips} pending`);
        console.log('----------------------\n');
    });

program.parse(process.argv);