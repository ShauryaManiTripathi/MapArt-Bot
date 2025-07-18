const sharp = require('sharp');
const path = require('path');
const axios = require('axios');
const fs = require('fs').promises;

// RGB values for Minecraft carpet colors
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

const COLOR_NAMES = Object.keys(COLOR_MAP);
const COLOR_INDEX_MAP = {};
COLOR_NAMES.forEach((name, index) => {
    COLOR_INDEX_MAP[name] = index;
});

// Function to find the closest color in our palette
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

// Dithering algorithms
class DitheringAlgorithms {
    // Floyd-Steinberg dithering
    static floydSteinberg(imageBuffer, width, height) {
        // Create a copy of the buffer to work with
        const data = Buffer.from(imageBuffer);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;
                
                const oldR = data[idx];
                const oldG = data[idx + 1];
                const oldB = data[idx + 2];
                
                const closestColorName = findClosestColor(oldR, oldG, oldB);
                const newColor = COLOR_MAP[closestColorName];
                
                data[idx] = newColor.r;
                data[idx + 1] = newColor.g;
                data[idx + 2] = newColor.b;
                
                const errorR = oldR - newColor.r;
                const errorG = oldG - newColor.g;
                const errorB = oldB - newColor.b;
                
                // Distribute error to neighboring pixels
                if (x + 1 < width) {
                    const rightIdx = (y * width + (x + 1)) * 3;
                    data[rightIdx] = Math.max(0, Math.min(255, data[rightIdx] + errorR * 7 / 16));
                    data[rightIdx + 1] = Math.max(0, Math.min(255, data[rightIdx + 1] + errorG * 7 / 16));
                    data[rightIdx + 2] = Math.max(0, Math.min(255, data[rightIdx + 2] + errorB * 7 / 16));
                }
                
                if (y + 1 < height) {
                    if (x - 1 >= 0) {
                        const bottomLeftIdx = ((y + 1) * width + (x - 1)) * 3;
                        data[bottomLeftIdx] = Math.max(0, Math.min(255, data[bottomLeftIdx] + errorR * 3 / 16));
                        data[bottomLeftIdx + 1] = Math.max(0, Math.min(255, data[bottomLeftIdx + 1] + errorG * 3 / 16));
                        data[bottomLeftIdx + 2] = Math.max(0, Math.min(255, data[bottomLeftIdx + 2] + errorB * 3 / 16));
                    }
                    
                    const bottomIdx = ((y + 1) * width + x) * 3;
                    data[bottomIdx] = Math.max(0, Math.min(255, data[bottomIdx] + errorR * 5 / 16));
                    data[bottomIdx + 1] = Math.max(0, Math.min(255, data[bottomIdx + 1] + errorG * 5 / 16));
                    data[bottomIdx + 2] = Math.max(0, Math.min(255, data[bottomIdx + 2] + errorB * 5 / 16));
                    
                    if (x + 1 < width) {
                        const bottomRightIdx = ((y + 1) * width + (x + 1)) * 3;
                        data[bottomRightIdx] = Math.max(0, Math.min(255, data[bottomRightIdx] + errorR * 1 / 16));
                        data[bottomRightIdx + 1] = Math.max(0, Math.min(255, data[bottomRightIdx + 1] + errorG * 1 / 16));
                        data[bottomRightIdx + 2] = Math.max(0, Math.min(255, data[bottomRightIdx + 2] + errorB * 1 / 16));
                    }
                }
            }
        }
        
        return data;
    }

    static jarvisJudiceNinke(imageBuffer, width, height) {
        const data = Buffer.from(imageBuffer);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;
                
                const oldR = data[idx];
                const oldG = data[idx + 1];
                const oldB = data[idx + 2];
                
                const closestColorName = findClosestColor(oldR, oldG, oldB);
                const newColor = COLOR_MAP[closestColorName];
                
                data[idx] = newColor.r;
                data[idx + 1] = newColor.g;
                data[idx + 2] = newColor.b;
                
                const errorR = oldR - newColor.r;
                const errorG = oldG - newColor.g;
                const errorB = oldB - newColor.b;
                
                // Jarvis-Judice-Ninke error diffusion pattern
                const diffusionPattern = [
                    { dx: 1, dy: 0, weight: 7/48 },
                    { dx: 2, dy: 0, weight: 5/48 },
                    { dx: -2, dy: 1, weight: 3/48 },
                    { dx: -1, dy: 1, weight: 5/48 },
                    { dx: 0, dy: 1, weight: 7/48 },
                    { dx: 1, dy: 1, weight: 5/48 },
                    { dx: 2, dy: 1, weight: 3/48 },
                    { dx: -2, dy: 2, weight: 1/48 },
                    { dx: -1, dy: 2, weight: 3/48 },
                    { dx: 0, dy: 2, weight: 5/48 },
                    { dx: 1, dy: 2, weight: 3/48 },
                    { dx: 2, dy: 2, weight: 1/48 }
                ];
                
                for (const { dx, dy, weight } of diffusionPattern) {
                    const newX = x + dx;
                    const newY = y + dy;
                    if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
                        const nIdx = (newY * width + newX) * 3;
                        data[nIdx] = Math.max(0, Math.min(255, data[nIdx] + errorR * weight));
                        data[nIdx + 1] = Math.max(0, Math.min(255, data[nIdx + 1] + errorG * weight));
                        data[nIdx + 2] = Math.max(0, Math.min(255, data[nIdx + 2] + errorB * weight));
                    }
                }
            }
        }
        
        return data;
    }

    static stucki(imageBuffer, width, height) {
        const data = Buffer.from(imageBuffer);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;
                
                const oldR = data[idx];
                const oldG = data[idx + 1];
                const oldB = data[idx + 2];
                
                const closestColorName = findClosestColor(oldR, oldG, oldB);
                const newColor = COLOR_MAP[closestColorName];
                
                data[idx] = newColor.r;
                data[idx + 1] = newColor.g;
                data[idx + 2] = newColor.b;
                
                const errorR = oldR - newColor.r;
                const errorG = oldG - newColor.g;
                const errorB = oldB - newColor.b;
                
                // Stucki error diffusion pattern
                const diffusionPattern = [
                    { dx: 1, dy: 0, weight: 8/42 },
                    { dx: 2, dy: 0, weight: 4/42 },
                    { dx: -2, dy: 1, weight: 2/42 },
                    { dx: -1, dy: 1, weight: 4/42 },
                    { dx: 0, dy: 1, weight: 8/42 },
                    { dx: 1, dy: 1, weight: 4/42 },
                    { dx: 2, dy: 1, weight: 2/42 },
                    { dx: -2, dy: 2, weight: 1/42 },
                    { dx: -1, dy: 2, weight: 2/42 },
                    { dx: 0, dy: 2, weight: 4/42 },
                    { dx: 1, dy: 2, weight: 2/42 },
                    { dx: 2, dy: 2, weight: 1/42 }
                ];
                
                for (const { dx, dy, weight } of diffusionPattern) {
                    const newX = x + dx;
                    const newY = y + dy;
                    if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
                        const nIdx = (newY * width + newX) * 3;
                        data[nIdx] = Math.max(0, Math.min(255, data[nIdx] + errorR * weight));
                        data[nIdx + 1] = Math.max(0, Math.min(255, data[nIdx + 1] + errorG * weight));
                        data[nIdx + 2] = Math.max(0, Math.min(255, data[nIdx + 2] + errorB * weight));
                    }
                }
            }
        }
        
        return data;
    }

    static atkinson(imageBuffer, width, height) {
        const data = Buffer.from(imageBuffer);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;
                
                const oldR = data[idx];
                const oldG = data[idx + 1];
                const oldB = data[idx + 2];
                
                const closestColorName = findClosestColor(oldR, oldG, oldB);
                const newColor = COLOR_MAP[closestColorName];
                
                data[idx] = newColor.r;
                data[idx + 1] = newColor.g;
                data[idx + 2] = newColor.b;
                
                const errorR = oldR - newColor.r;
                const errorG = oldG - newColor.g;
                const errorB = oldB - newColor.b;
                
                // Atkinson error diffusion pattern
                const diffusionPattern = [
                    { dx: 1, dy: 0, weight: 1/8 },
                    { dx: 2, dy: 0, weight: 1/8 },
                    { dx: -1, dy: 1, weight: 1/8 },
                    { dx: 0, dy: 1, weight: 1/8 },
                    { dx: 1, dy: 1, weight: 1/8 },
                    { dx: 0, dy: 2, weight: 1/8 }
                ];
                
                for (const { dx, dy, weight } of diffusionPattern) {
                    const newX = x + dx;
                    const newY = y + dy;
                    if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
                        const nIdx = (newY * width + newX) * 3;
                        data[nIdx] = Math.max(0, Math.min(255, data[nIdx] + errorR * weight));
                        data[nIdx + 1] = Math.max(0, Math.min(255, data[nIdx + 1] + errorG * weight));
                        data[nIdx + 2] = Math.max(0, Math.min(255, data[nIdx + 2] + errorB * weight));
                    }
                }
            }
        }
        
        return data;
    }

    static sierra(imageBuffer, width, height) {
        const data = Buffer.from(imageBuffer);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;
                
                const oldR = data[idx];
                const oldG = data[idx + 1];
                const oldB = data[idx + 2];
                
                const closestColorName = findClosestColor(oldR, oldG, oldB);
                const newColor = COLOR_MAP[closestColorName];
                
                data[idx] = newColor.r;
                data[idx + 1] = newColor.g;
                data[idx + 2] = newColor.b;
                
                const errorR = oldR - newColor.r;
                const errorG = oldG - newColor.g;
                const errorB = oldB - newColor.b;
                
                // Sierra error diffusion pattern
                const diffusionPattern = [
                    { dx: 1, dy: 0, weight: 5/32 },
                    { dx: 2, dy: 0, weight: 3/32 },
                    { dx: -2, dy: 1, weight: 2/32 },
                    { dx: -1, dy: 1, weight: 4/32 },
                    { dx: 0, dy: 1, weight: 5/32 },
                    { dx: 1, dy: 1, weight: 4/32 },
                    { dx: 2, dy: 1, weight: 2/32 },
                    { dx: -1, dy: 2, weight: 2/32 },
                    { dx: 0, dy: 2, weight: 3/32 },
                    { dx: 1, dy: 2, weight: 2/32 }
                ];
                
                for (const { dx, dy, weight } of diffusionPattern) {
                    const newX = x + dx;
                    const newY = y + dy;
                    if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
                        const nIdx = (newY * width + newX) * 3;
                        data[nIdx] = Math.max(0, Math.min(255, data[nIdx] + errorR * weight));
                        data[nIdx + 1] = Math.max(0, Math.min(255, data[nIdx + 1] + errorG * weight));
                        data[nIdx + 2] = Math.max(0, Math.min(255, data[nIdx + 2] + errorB * weight));
                    }
                }
            }
        }
        
        return data;
    }

    static burkes(imageBuffer, width, height) {
        const data = Buffer.from(imageBuffer);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;
                
                const oldR = data[idx];
                const oldG = data[idx + 1];
                const oldB = data[idx + 2];
                
                const closestColorName = findClosestColor(oldR, oldG, oldB);
                const newColor = COLOR_MAP[closestColorName];
                
                data[idx] = newColor.r;
                data[idx + 1] = newColor.g;
                data[idx + 2] = newColor.b;
                
                const errorR = oldR - newColor.r;
                const errorG = oldG - newColor.g;
                const errorB = oldB - newColor.b;
                
                // Burkes error diffusion pattern
                const diffusionPattern = [
                    { dx: 1, dy: 0, weight: 8/32 },
                    { dx: 2, dy: 0, weight: 4/32 },
                    { dx: -2, dy: 1, weight: 2/32 },
                    { dx: -1, dy: 1, weight: 4/32 },
                    { dx: 0, dy: 1, weight: 8/32 },
                    { dx: 1, dy: 1, weight: 4/32 },
                    { dx: 2, dy: 1, weight: 2/32 }
                ];
                
                for (const { dx, dy, weight } of diffusionPattern) {
                    const newX = x + dx;
                    const newY = y + dy;
                    if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
                        const nIdx = (newY * width + newX) * 3;
                        data[nIdx] = Math.max(0, Math.min(255, data[nIdx] + errorR * weight));
                        data[nIdx + 1] = Math.max(0, Math.min(255, data[nIdx + 1] + errorG * weight));
                        data[nIdx + 2] = Math.max(0, Math.min(255, data[nIdx + 2] + errorB * weight));
                    }
                }
            }
        }
        
        return data;
    }
}

class ImageProcessor {
    /**
     * Processes a large image and splits it into 128x128 chunks
     * @param {string} imageSource - URL or local path to the image
     * @param {number} width - Number of horizontal chunks
     * @param {number} height - Number of vertical chunks
     * @param {string} ditheringMethod - Dithering algorithm to use
     */
    static async processLargeImage(imageSource, width, height, ditheringMethod = 'floydSteinberg') {
        try {
            console.log(`Processing image with dimensions: ${width}x${height} chunks (${width * 128}x${height * 128} pixels)`);
            
            // Step 1: Download/load and upscale image
            let imageBuffer;
            if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
                console.log(`Downloading image from: ${imageSource}`);
                const response = await axios.get(imageSource, { responseType: 'arraybuffer' });
                imageBuffer = Buffer.from(response.data);
            } else {
                console.log(`Reading local image: ${imageSource}`);
                imageBuffer = await fs.readFile(imageSource);
            }
            
            // Step 2: Upscale to target dimensions
            const targetWidth = width * 128;
            const targetHeight = height * 128;
            
            console.log(`Upscaling to ${targetWidth}x${targetHeight}`);
            const upscaledBuffer = await sharp(imageBuffer)
                .resize(targetWidth, targetHeight, {
                    fit: 'fill',
                    kernel: sharp.kernel.lanczos3
                })
                .rotate(180)
                .raw()
                .toBuffer({ resolveWithObject: true });
            
            // Save upscaled image
            await sharp(upscaledBuffer.data, {
                raw: {
                    width: targetWidth,
                    height: targetHeight,
                    channels: 3
                }
            })
            .png()
            .toFile('processed/image_upscaled.png');
            
            console.log('Upscaled image saved as image_upscaled.png');
            
            // Step 3: Apply dithering
            console.log(`Applying ${ditheringMethod} dithering...`);
            let ditheredBuffer;
            switch (ditheringMethod) {
                case 'floydSteinberg':
                    ditheredBuffer = DitheringAlgorithms.floydSteinberg(upscaledBuffer.data, targetWidth, targetHeight);
                    break;
                case 'jarvisJudiceNinke':
                    ditheredBuffer = DitheringAlgorithms.jarvisJudiceNinke(upscaledBuffer.data, targetWidth, targetHeight);
                    break;
                case 'stucki':
                    ditheredBuffer = DitheringAlgorithms.stucki(upscaledBuffer.data, targetWidth, targetHeight);
                    break;
                case 'atkinson':
                    ditheredBuffer = DitheringAlgorithms.atkinson(upscaledBuffer.data, targetWidth, targetHeight);
                    break;
                case 'sierra':
                    ditheredBuffer = DitheringAlgorithms.sierra(upscaledBuffer.data, targetWidth, targetHeight);
                    break;
                case 'burkes':
                    ditheredBuffer = DitheringAlgorithms.burkes(upscaledBuffer.data, targetWidth, targetHeight);
                    break;
                default:
                    console.log(`Unknown dithering method: ${ditheringMethod}. Using Floyd-Steinberg.`);
                    ditheredBuffer = DitheringAlgorithms.floydSteinberg(upscaledBuffer.data, targetWidth, targetHeight);
            }
            
            // Save dithered image
            await sharp(ditheredBuffer, {
                raw: {
                    width: targetWidth,
                    height: targetHeight,
                    channels: 3
                }
            })
            .png()
            .toFile('processed/image_dithered.png');
            
            console.log('Dithered image saved as image_dithered.png');
            
            // Step 4: Split into 128x128 chunks and process each
            console.log('Processing chunks...');
            await this.processChunks(upscaledBuffer.data, ditheredBuffer, targetWidth, targetHeight, width, height);
            
            console.log('Processing completed successfully!');
            
        } catch (error) {
            console.error(`Failed to process image: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Process and save individual 128x128 chunks
     */
    static async processChunks(upscaledBuffer, ditheredBuffer, totalWidth, totalHeight, chunksWidth, chunksHeight) {
        for (let i = 0; i < chunksHeight; i++) {
            for (let j = 0; j < chunksWidth; j++) {
                console.log(`Processing chunk ${i}_${j}`);
                
                // Extract 128x128 chunk from upscaled image
                const chunkUpscaled = await this.extractChunk(upscaledBuffer, totalWidth, totalHeight, j * 128, i * 128, 128, 128);
                
                // Extract 128x128 chunk from dithered image
                const chunkDithered = await this.extractChunk(ditheredBuffer, totalWidth, totalHeight, j * 128, i * 128, 128, 128);
                
                // Save chunk images
                await sharp(chunkUpscaled, {
                    raw: {
                        width: 128,
                        height: 128,
                        channels: 3
                    }
                })
                .png()
                .toFile(`processed/${i}_${j}_after_upscaled.png`);
                
                await sharp(chunkDithered, {
                    raw: {
                        width: 128,
                        height: 128,
                        channels: 3
                    }
                })
                .png()
                .toFile(`processed/${i}_${j}_after_upscale_and_dither.png`);
                
                // Generate color index array for this chunk
                const colorIndexArray = this.generateColorIndexArray(chunkDithered, 128, 128);
                
                // Save JSON file
                await fs.writeFile(`processed/${i}_${j}.json`, JSON.stringify(colorIndexArray, null, 2));
                
                console.log(`Chunk ${i}_${j} processed and saved`);
            }
        }
    }
    
    /**
     * Extract a chunk from the image buffer
     */
    static async extractChunk(sourceBuffer, sourceWidth, sourceHeight, startX, startY, chunkWidth, chunkHeight) {
        const chunkBuffer = Buffer.alloc(chunkWidth * chunkHeight * 3);
        
        for (let y = 0; y < chunkHeight; y++) {
            for (let x = 0; x < chunkWidth; x++) {
                const sourceIdx = ((startY + y) * sourceWidth + (startX + x)) * 3;
                const chunkIdx = (y * chunkWidth + x) * 3;
                
                if (sourceIdx < sourceBuffer.length - 2) {
                    chunkBuffer[chunkIdx] = sourceBuffer[sourceIdx];
                    chunkBuffer[chunkIdx + 1] = sourceBuffer[sourceIdx + 1];
                    chunkBuffer[chunkIdx + 2] = sourceBuffer[sourceIdx + 2];
                }
            }
        }
        
        return chunkBuffer;
    }
    
    /**
     * Generate color index array from image buffer
     */
    static generateColorIndexArray(imageBuffer, width, height) {
        const colorArray = [];
        
        for (let y = 0; y < height; y++) {
            const row = [];
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;
                const r = imageBuffer[idx];
                const g = imageBuffer[idx + 1];
                const b = imageBuffer[idx + 2];
                
                const closestColorName = findClosestColor(r, g, b);
                const colorIndex = COLOR_INDEX_MAP[closestColorName];
                row.push(colorIndex);
            }
            colorArray.push(row);
        }
        
        return colorArray;
    }
}

// Export for use
module.exports = ImageProcessor;

// Example usage:
ImageProcessor.processLargeImage('https://upload.wikimedia.org/wikipedia/commons/5/5e/Messier83_-_Heic1403a.jpg', 100, 100, 'floydSteinberg');