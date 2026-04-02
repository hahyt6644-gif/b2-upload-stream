const express = require('express');
const axios = require('axios');
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
let logs = [];

function addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `[${timestamp}] ${message}`;
    console.log(entry);
    logs.unshift(entry);
    if (logs.length > 50) logs.pop();
}

const s3Client = new S3Client({
    endpoint: "https://s3.us-east-005.backblazeb2.com",
    region: "us-east-005",
    credentials: {
        accessKeyId: process.env.B2_KEY_ID, 
        secretAccessKey: process.env.B2_APP_KEY,
    },
});

async function uploadToB2(key, body, contentType) {
    const upload = new Upload({
        client: s3Client,
        params: { Bucket: "tera-stream-itz", Key: key, Body: body, ContentType: contentType },
    });
    return upload.done();
}

async function mirrorHLS(quality, url, videoId) {
    addLog(`Processing ${quality}...`);
    try {
        const playlistRes = await axios.get(url);
        let playlistText = playlistRes.data;

        // --- SKIPPING FIX (Relative Paths) ---
        // This removes the long URLs from the index file so VLC keeps your token
        const lines = playlistText.split('\n');
        const cleanedLines = lines.map(line => {
            if (line.trim().endsWith('.ts') || line.includes('.ts?')) {
                return line.split('?')[0].split('/').pop();
            }
            return line;
        });
        const cleanedPlaylist = cleanedLines.join('\n');

        await uploadToB2(`${videoId}/${quality}/index.m3u8`, cleanedPlaylist, 'application/x-mpegURL');

        // Identify segments for downloading
        const segments = playlistText.match(/.*\.ts/g);
        if (segments) {
            addLog(`Found ${segments.length} segments for ${quality}`);
            for (let i = 0; i < segments.length; i++) {
                const segmentLine = segments[i];
                const cleanFileName = segmentLine.split('?')[0].split('/').pop();
                const segmentUrl = new URL(segmentLine, url).href;

                const segmentStream = await axios({ method: 'get', url: segmentUrl, responseType: 'stream' });
                await uploadToB2(`${videoId}/${quality}/${cleanFileName}`, segmentStream.data, 'video/MP2T');
                
                if (i % 10 === 0) addLog(`Progress ${quality}: ${i + 1}/${segments.length}`);
            }
            addLog(`✅ ${quality} Mirrored.`);
        }
    } catch (err) {
        addLog(`❌ Error in ${quality}: ${err.message}`);
    }
}

// Function to create a Master Playlist (.m3u8)
async function createMasterPlaylist(videoData, videoId) {
    addLog("Generating Master Playlist...");
    let masterContent = "#EXTM3U\n#EXT-X-VERSION:3\n\n";

    for (const [quality, url] of Object.entries(videoData.fast_stream_url)) {
        let bandwidth = "800000"; // Default
        let resolution = "640x360";

        if (quality === "480p") { bandwidth = "1400000"; resolution = "854x480"; }
        if (quality === "720p") { bandwidth = "2800000"; resolution = "1280x720"; }
        if (quality === "1080p") { bandwidth = "5000000"; resolution = "1920x1080"; }

        masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}\n`;
        masterContent += `${quality}/index.m3u8\n\n`;
    }

    await uploadToB2(`${videoId}/master.m3u8`, masterContent, 'application/x-mpegURL');
    addLog("🏁 Master Playlist uploaded!");
}

app.get('/', (req, res) => {
    const logHtml = logs.map(l => `<div>${l}</div>`).join('');
    res.send(`<html><body style="background:#121212;color:#0f0;font-family:monospace;padding:20px;">
        <h2>B2 Mirror Console</h2><meta http-equiv="refresh" content="5">
        <div style="background:#000;padding:10px;height:450px;overflow-y:auto;border:1px solid #333;">${logHtml || "System Ready..."}</div>
    </body></html>`);
});

app.post('/mirror', async (req, res) => {
    const { videoData, videoId } = req.body;
    if (!videoData || !videoId) return res.status(400).json({ error: "Invalid payload" });

    res.json({ message: "Task started", videoId });

    (async () => {
        for (const [quality, url] of Object.entries(videoData.fast_stream_url)) {
            await mirrorHLS(quality, url, videoId);
        }
        await createMasterPlaylist(videoData, videoId);
        addLog(`✨ ALL DONE: ${videoId}`);
    })();
});

app.listen(PORT, () => addLog(`Server live on port ${PORT}`));
