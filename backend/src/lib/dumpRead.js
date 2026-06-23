import fs from 'fs';
import path from 'path';

function ReadDump(filename, raw = false, FlippedAndRotated = false, DenoiseRequired = false) {
    const fileBuffer = fs.readFileSync(filename);
    let offset = 0;
    
    // Read gate
    let gate = '';
    while (offset < fileBuffer.length) {
        const byte = fileBuffer[offset];
        offset++;
        if (byte === 10) { // newline
            break;
        }
        gate += String.fromCharCode(byte);
    }
    gate = gate.trim();
    
    // Read dimensions
    let dimsStr = '';
    while (offset < fileBuffer.length) {
        const byte = fileBuffer[offset];
        offset++;
        if (byte === 10) { // newline
            break;
        }
        dimsStr += String.fromCharCode(byte);
    }
    const dims = dimsStr.trim().split(/\s+/);
    const cols = Math.floor(parseInt(dims[0]) / 2);
    const rows = parseInt(dims[1]);
    
    // Skip comment lines
    let line = '';
    let checkDenoise = false;
    while (offset < fileBuffer.length) {
        const byte = fileBuffer[offset];
        offset++;
        if (byte === 10) { // newline
            if (line.trim().startsWith('#')) {
                if (line.includes('denoised')) {
                    if (line.includes('denoised=0')) {
                        checkDenoise = false;
                    } else {
                        checkDenoise = true;
                    }
                }
                line = '';
            } else {
                // Put back the character that's not a comment
                offset--;
                break;
            }
        } else {
            line += String.fromCharCode(byte);
        }
    }
    
    // Read high and low data
    const high = new Array(rows);
    const low = new Array(rows);
    for (let i = 0; i < rows; i++) {
        high[i] = new Array(cols);
        low[i] = new Array(cols);
        for (let j = 0; j < cols; j++) {
            // Read high value (2 bytes, little endian)
            const highVal = fileBuffer.readUInt16LE(offset);
            offset += 2;
            high[i][j] = highVal;
            
            // Read low value (2 bytes, little endian)
            const lowVal = fileBuffer.readUInt16LE(offset);
            offset += 2;
            
            low[i][j] = lowVal;
        }
    }
    
    // Skip to #Raw Data Dump
    let rawDataFound = false;
    let rawLine = '';
    while (offset < fileBuffer.length) {
        const byte = fileBuffer[offset];
        offset++;
        if (byte === 10) { // newline
            if (rawLine.trim() === '#Raw Data Dump') {
                rawDataFound = true;
                break;
            }
            rawLine = '';
        } else {
            rawLine += String.fromCharCode(byte);
        }
    }
    
    // Read raw data
    const high_raw = new Array(rows);
    const low_raw = new Array(rows);
    if (rawDataFound) {
        for (let i = 0; i < rows; i++) {
            high_raw[i] = new Array(cols);
            low_raw[i] = new Array(cols);
            for (let j = 0; j < cols; j++) {
                high_raw[i][j] = fileBuffer.readUInt16LE(offset);
                offset += 2;
                
                low_raw[i][j] = fileBuffer.readUInt16LE(offset);
                offset += 2;
            }
        }
    }
    
    // Calculate R
    const R = new Array(rows);
    for (let i = 0; i < rows; i++) {
        R[i] = new Array(cols);
        for (let j = 0; j < cols; j++) {
            if (low[i][j] < 60000 && low[i][j] !== 0 && high[i][j] !== 0) {
                R[i][j] = Math.log(high[i][j] / 65535) / Math.log(low[i][j] / 65535);
            } else if (low[i][j] === 0) {
                R[i][j] = 0;
            } else if (high[i][j] === 0) {
                R[i][j] = 0;
            } else if (low[i][j] >= 60000) {
                R[i][j] = Infinity;
            }
        }
    }
    
    if (raw) {
        return { high, low, high_raw, low_raw };
    } else if (FlippedAndRotated) {
        // Flip and rotate (transpose and flip)
        const transposedHigh = [];
        const transposedLow = [];
        const transposedR = [];
        for (let j = 0; j < cols; j++) {
            transposedHigh[j] = [];
            transposedLow[j] = [];
            transposedR[j] = [];
            for (let i = rows - 1; i >= 0; i--) {
                transposedHigh[j].push(high[i][j]);
                transposedLow[j].push(low[i][j]);
                transposedR[j].push(R[i][j]);
            }
        }
        return { high: transposedHigh, low: transposedLow, R: transposedR };
    } else {
        return { high, low, R };
    }
}

function toUint16(array) {
    return array.map(row => row.map(val => Math.min(65535, Math.max(0, Math.round(val)))));
}

export { ReadDump, toUint16 };
