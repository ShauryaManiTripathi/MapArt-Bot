const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

// IMPORTANT: This COLOR_MAP must be IDENTICAL to the one used in ImageProcessor.js
// It is the key to decoding the numbers in the .json files.
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

// Create a simple array of color names to easily look up a color by its index.
const COLOR_NAMES = Object.keys(COLOR_MAP);

class ImageReconstructor {
    /**
     * Reconstructs a large image from a grid of JSON files.
     * @param {number} chunksWidth - The number of horizontal chunks.
     * @param {number} chunksHeight - The number of vertical chunks.
     * @param {string} outputFilename - The name of the file to save the reconstructed image to.
     */
    static async reconstructImage(chunksWidth, chunksHeight, outputFilename = 'reconstructed_image.png') {
        try {
            console.log(`Starting reconstruction for a ${chunksWidth}x${chunksHeight} grid...`);

            const finalWidth = chunksWidth * 128;
            const finalHeight = chunksHeight * 128;
            const channels = 3; // R, G, B

            // Create a large buffer in memory to hold the raw pixel data for the final image.
            const finalImageBuffer = Buffer.alloc(finalWidth * finalHeight * channels);

            // Iterate through each expected chunk file.
            for (let i = 0; i < chunksHeight; i++) { // 'i' is the row (y-axis)
                for (let j = 0; j < chunksWidth; j++) { // 'j' is the column (x-axis)
                    const filename = `${i}_${j}.json`;
                    console.log(`Reading chunk: ${filename}`);

                    let fileContent;
                    try {
                        fileContent = await fs.readFile(filename, 'utf-8');
                    } catch (e) {
                        console.error(`Error: Could not read chunk file ${filename}. Make sure it exists.`);
                        // Fill this chunk area with black as a visual indicator of the missing file.
                        for (let y = 0; y < 128; y++) {
                            for (let x = 0; x < 128; x++) {
                                const globalX = j * 128 + x;
                                const globalY = i * 128 + y;
                                const targetIdx = (globalY * finalWidth + globalX) * channels;
                                finalImageBuffer[targetIdx] = 0;     // R
                                finalImageBuffer[targetIdx + 1] = 0; // G
                                finalImageBuffer[targetIdx + 2] = 0; // B
                            }
                        }
                        continue; // Skip to the next chunk
                    }

                    const colorIndexArray = JSON.parse(fileContent);

                    // Iterate through the 128x128 pixels of this chunk
                    for (let y = 0; y < 128; y++) {
                        for (let x = 0; x < 128; x++) {
                            // 1. Get the color data for the pixel
                            const colorIndex = colorIndexArray[y][x];
                            const colorName = COLOR_NAMES[colorIndex];
                            const { r, g, b } = COLOR_MAP[colorName];

                            // 2. Calculate where this pixel goes in the final large image
                            const globalX = j * 128 + x;
                            const globalY = i * 128 + y;
                            const targetIdx = (globalY * finalWidth + globalX) * channels;

                            // 3. Place the RGB data into the final buffer
                            finalImageBuffer[targetIdx] = r;
                            finalImageBuffer[targetIdx + 1] = g;
                            finalImageBuffer[targetIdx + 2] = b;
                        }
                    }
                }
            }

            console.log('All chunks processed. Saving final image...');

            // Use Sharp to save the raw pixel buffer as a PNG file.
            await sharp(finalImageBuffer, {
                raw: {
                    width: finalWidth,
                    height: finalHeight,
                    channels: channels
                }
            })
            .png()
            .toFile(outputFilename);

            console.log(`Reconstruction complete! Image saved as ${outputFilename}`);

        } catch (error) {
            console.error(`An error occurred during reconstruction: ${error.message}`);
            console.error(error.stack);
        }
    }
}

// --- Example Usage ---
// This function will run when you execute the script directly.
async function run() {
    // *** IMPORTANT: Set these values to match the dimensions you used for processing! ***
    const MAP_WIDTH = 25; // The number of chunks wide
    const MAP_HEIGHT = 25; // The number of chunks high

    await ImageReconstructor.reconstructImage(MAP_WIDTH, MAP_HEIGHT, 'final_reconstructed_map.png');
}

run();