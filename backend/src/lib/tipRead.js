import fs from 'fs';

function readTip(filename) {
    const fileBuffer = fs.readFileSync(filename);
    let offset = 0;
    
    // Read magic
    let magic = '';
    while (offset < fileBuffer.length) {
        const byte = fileBuffer[offset];
        offset++;
        if (byte === 10) {
            break;
        }
        magic += String.fromCharCode(byte);
    }
    magic = magic.trim();
    
    if (magic !== 'P5') {
        throw new Error('Not a valid P5 PGM file');
    }
    
    // Read dimension line, skip comments
    let width = 0, height = 0;
    while (offset < fileBuffer.length) {
        let line = '';
        while (offset < fileBuffer.length) {
            const byte = fileBuffer[offset];
            offset++;
            if (byte === 10) {
                break;
            }
            line += String.fromCharCode(byte);
        }
        line = line.trim();
        if (line.startsWith('#')) {
            continue;
        }
        const dims = line.split(/\s+/);
        width = parseInt(dims[0]);
        height = parseInt(dims[1]);
        break;
    }
    
    // Read maxval line, skip comments
    let maxval = 0;
    while (offset < fileBuffer.length) {
        let line = '';
        while (offset < fileBuffer.length) {
            const byte = fileBuffer[offset];
            offset++;
            if (byte === 10) {
                break;
            }
            line += String.fromCharCode(byte);
        }
        line = line.trim();
        if (line.startsWith('#')) {
            continue;
        }
        maxval = parseInt(line);
        break;
    }
    
    if (maxval !== 65535) {
        throw new Error('Expected maxval of 65535 for 16-bit PGM');
    }
    
    // Read interleaved data
    const cols = Math.floor(width / 2);
    const rows = height;
    const high_raw = new Array(rows);
    const low_raw = new Array(rows);
    
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
    
    return { low_raw, high_raw };
}

export { readTip };
