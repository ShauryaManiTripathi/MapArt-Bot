const blessed = require('blessed');
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const util = require('util');

// --- UI & Logging Setup (Hijack Console FIRST) ---

const screen = blessed.screen({
    smartCSR: true,
    title: 'MapArtBot Control Panel',
    fullUnicode: true,
    mouse: true // Enable mouse events for the whole screen
});

const logBox = blessed.log({
    parent: screen,
    top: 0,
    left: 'center',
    width: '100%',
    height: '95%',
    border: 'line',
    label: ' {bold}Logs{/bold} ',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
        ch: ' ',
        style: { bg: 'cyan' }
    },
    mouse: true, // Allow this widget to receive mouse events
    keys: true   // Allow this widget to receive key events (for scrolling)
});

// THE PIPELINE: Redirect all console output to the blessed logBox
const redirectConsole = () => {
    const format = (...args) => util.format(...args);

    console.log = (...args) => logBox.log(format(...args));
    console.error = (...args) => logBox.log(`{red-fg}${format(...args)}{/red-fg}`);
    console.warn = (...args) => logBox.log(`{yellow-fg}${format(...args)}{/yellow-fg}`);
    console.info = (...args) => logBox.log(`{blue-fg}${format(...args)}{/blue-fg}`);
    console.debug = (...args) => logBox.log(`{gray-fg}${format(...args)}{/gray-fg}`);
};

redirectConsole();

const inputBox = blessed.textbox({
    parent: screen,
    bottom: 0,
    left: 'center',
    width: '100%',
    height: 'shrink',
    border: 'line',
    label: ' {bold}Command{/bold} ',
    tags: true,
    inputOnFocus: true
});

// --- App Dependencies (Load AFTER hijacking console) ---
const botConfigs = require('./config/bots.json');
const mapArtOffsets = require('./config/mapart_offsets.js');
const ImageProcessor = require('./src/utils/ImageProcessor.js');
const DatabaseManager = require('./src/utils/DatabaseManager.js');

// --- Global State ---
const DB_PATH = path.join(process.cwd(), 'mapart.sqlite');
const WORKER_PATH = path.join(__dirname, 'worker.js');
let childProcesses = [];
let db;

// --- Core Functions ---
const shutdown = () => {
    console.log('{yellow-fg}Shutting down bot processes...{/yellow-fg}');
    childProcesses.forEach(child => {
        child.kill('SIGINT');
    });
    setTimeout(() => process.exit(0), 1500);
};

screen.key(['escape', 'q', 'C-c'], shutdown);
inputBox.focus();

// --- Global Scroll Keybindings ---
screen.key(['pageup'], () => {
    logBox.scroll(-logBox.height + 1);
    screen.render();
});
screen.key(['pagedown'], () => {
    logBox.scroll(logBox.height - 1);
    screen.render();
});
// Using Shift + Arrow keys for line-by-line scrolling
screen.key(['S-up'], () => { logBox.scroll(-1); screen.render(); });
screen.key(['S-down'], () => { logBox.scroll(1); screen.render(); });

const launchBots = () => {
    if (childProcesses.length > 0) {
        console.info('Bots are already running.');
        return;
    }
    if (!fs.existsSync(WORKER_PATH)) {
        console.error(`Error: Worker script not found at ${WORKER_PATH}`);
        return;
    }
    const totalBots = botConfigs.length;
    if (totalBots === 0) {
        console.error("No bots defined in config/bots.json. Aborting.");
        return;
    }

    console.log(`{green-fg}Launching ${totalBots} bot(s)...{/green-fg}`);
    botConfigs.forEach((botConfig, index) => {
        const child = fork(WORKER_PATH, [
            JSON.stringify(botConfig), DB_PATH, index.toString(), totalBots.toString()
        ], {
            stdio: 'pipe'
        });

        child.stdout.on('data', (data) => console.log(data.toString().trim()));
        child.stderr.on('data', (data) => console.error(data.toString().trim()));

        childProcesses.push(child);
    });
};

// --- Command Handlers ---
const commands = {
    'start': async ([imageSource, dither = 'floydSteinberg']) => {
        if (!imageSource) return console.warn('Usage: start <image_source> [dither_algorithm]');
        console.log(`{yellow-fg}Starting new map art project...{/yellow-fg}`);

        const validAlgorithms = ['floydSteinberg', 'jarvisJudiceNinke', 'stucki', 'atkinson', 'sierra', 'burkes'];
        if (!validAlgorithms.includes(dither)) {
            return console.error(`Invalid dithering algorithm: "${dither}". Valid: ${validAlgorithms.join(', ')}`);
        }

        const imageData = await ImageProcessor.processImage(imageSource, dither);
        if (!imageData) return console.error('Failed to process image. Aborting.');

        await db.startNewMapArt(imageSource, dither, imageData, mapArtOffsets.width);
        console.log('{green-fg}Project created successfully. Bots will begin work.{/green-fg}');
        launchBots();
    },
    'continue': async () => {
        const project = await db.getProjectState();
        if (!project || !project.is_active) return console.warn('No active project to continue.');
        if (!project.is_paused) return console.info('Project is already running.');
        await db.setPaused(false);
        console.log('{green-fg}Project resumed.{/green-fg}');
        launchBots();
    },
    'pause': async () => {
        await db.setPaused(true);
        console.warn('Pause command sent. Bots will idle on their next check.');
    },
    'status': async () => {
        const stats = await db.getCompletionStats();
        if (!stats.project) return console.warn('No active project found.');
        const percentage = stats.total_blocks > 0 ? ((stats.placed_blocks / stats.total_blocks) * 100).toFixed(2) : "0.00";
        console.log('\n{bold}--- Map Art Status ---{/bold}');
        console.log(`  Project Active: ${stats.project.is_active ? 'Yes' : 'No'}, Paused: ${stats.project.is_paused ? 'Yes' : 'No'}`);
        console.log(`  Overall:        ${percentage}% complete`);
        console.log(`  Blocks:         ${stats.placed_blocks} / ${stats.total_blocks}`);
        console.log(`  Strips:         ${stats.completed_strips} / ${stats.total_strips} completed (${stats.assigned_strips} assigned, ${stats.pending_strips} pending)`);
        console.log('{bold}----------------------{/bold}\n');
    },
    'clear': async () => {
        console.warn('Clearing project progress from the database...');
        await db.clearProject();
        console.log('{green-fg}Project cleared.{/green-fg}');
    },
    'exit': shutdown,
    'help': () => {
        console.log('\n{bold}Available Commands:{/bold}');
        console.log('  {cyan-fg}start <image_url_or_path> [dither]{/cyan-fg} - Clears and starts a new project.');
        console.log('  {cyan-fg}pause{/cyan-fg} - Pauses the current project.');
        console.log('  {cyan-fg}continue{/cyan-fg} - Resumes a paused project and launches bots if needed.');
        console.log('  {cyan-fg}status{/cyan-fg} - Displays the current project status.');
        console.log('  {cyan-fg}clear{/cyan-fg} - Deletes all project data from the database.');
        console.log('  {cyan-fg}exit / q{/cyan-fg} - Shuts down all bots and closes the application.');
    }
};

// --- Main Application Logic ---
inputBox.on('submit', async (text) => {
    const commandStr = text.trim();
    inputBox.clearValue();
    inputBox.focus();
    if (commandStr) {
        console.log(`{blue-fg}> ${commandStr}{/blue-fg}`);
        const [command, ...args] = commandStr.split(/\s+/);
        if (commands[command]) {
            try {
                await commands[command](args);
            } catch (error) {
                console.error(`Error executing '${command}': ${error.message}`);
                console.error(error.stack);
            }
        } else {
            console.error(`Unknown command: '${command}'. Type 'help' for a list of commands.`);
        }
    }
    screen.render();
});

setInterval(() => screen.render(), 250);

const main = async () => {
    db = new DatabaseManager(DB_PATH);
    await db.init();
    console.log('{green-fg}MapArtBot Control Panel Initialized.{/green-fg}');
    console.info("Type 'help' for a list of commands. Press 'q' or 'escape' to exit.");
};

main();