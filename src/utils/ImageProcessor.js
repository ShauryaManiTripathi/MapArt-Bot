const Jimp = require('jimp');
const path = require('path');
const axios = require('axios');

// RGB values for Minecraft carpet colors (Unchanged)
const COLOR_MAP = {
    white: { r: 221, g: 221, b: 221, id: 'white_carpet' },
    light_gray: { r: 170, g: 170, b: 170, id: 'light_gray_carpet' }, // Note: light_gray_carpet
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

const COLOR_NAMES = Object.keys(COLOR_MAP);

// Function to find the closest color in our palette (Unchanged)
function findClosestColor(r, g, b) {
    let closestColor = 'white';
    let minDistance = Infinity;

    for (const colorName of COLOR_NAMES) {
        const color = COLOR_MAP[colorName];
        const distance = Math.pow(r - color.r, 2) + Math.pow(g - color.g, 2) + Math.pow(b - color.b, 2);
        if (distance < minDistance) {
            minDistance = distance;
            closestColor = colorName;
        }
    }
    return closestColor;
}

class ImageProcessor {
    /**
     * Processes an image from a local file path or a URL.
     * @param {string} imageSource - The local file name (in ./assets) or a public URL to the image.
     * @returns {Promise<Array<Array<object>>|null>} A 128x128 2D array representing the map art plan, or null on failure.
     */
    static async processImage(imageSource) {
        let image;
        try {
            // Check if the source is a URL
            if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
                console.log(`Fetching image from URL: ${imageSource}`);
                const response = await axios.get(imageSource, {
                    responseType: 'arraybuffer' // Get image as a buffer
                });
                image = await Jimp.read(response.data);
            } else {
                // Assume it's a local file path
                const localPath = path.join('assets', imageSource);
                console.log(`Reading image from local path: ${localPath}`);
                image = await Jimp.read(localPath);
            }
            
            image.resize(128, 128);

            const imageData = Array.from({ length: 128 }, () => Array(128).fill(null));

            for (let z = 0; z < 128; z++) {
                for (let x = 0; x < 128; x++) {
                    const pixelColor = Jimp.intToRGBA(image.getPixelColor(x, z));
                    const closestColorName = findClosestColor(pixelColor.r, pixelColor.g, pixelColor.b);
                    imageData[z][x] = {
                        name: closestColorName,
                        id: COLOR_MAP[closestColorName].id,
                        placed_correctly: false // Default to false
                    };
                }
            }

            console.log(`Image "${imageSource}" processed successfully.`);
            return imageData;
        } catch (error) {
            console.error(`Failed to process image: ${error.message}`);
            return null;
        }
    }
}

ImageProcessor.COLOR_MAP = COLOR_MAP;

module.exports = ImageProcessor;