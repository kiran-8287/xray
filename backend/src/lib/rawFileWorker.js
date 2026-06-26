// rawFileWorker.js — ESM Worker Thread
// Uses createRequire to bridge the CommonJS readers (dumpRead.js, tipRead.js)

import { createRequire } from "module";
import { parentPort } from "node:worker_threads";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const { ReadDump } = require("./dumpRead.js");
const { read_tip } = require("./tipRead.js");

// Processing logic will be added in task 2.2
