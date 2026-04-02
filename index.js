const express = require('express');
const axios = require('axios');
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const app = express();
app.use(express.json()); // Allows the server to read JSON bodies

const PORT = process.env.PORT || 3000;

// Initialize B2 Client
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
        params: { 
            Bucket: "tera-stream-itz", 
            Key: key, 
            Body: body, 
            ContentType: contentType 
        },
    });
    return upload.done();
}

// The Core Logic
async function mirrorHLS(quality, url, videoId) {
    const playlistRes = await axios.get(url);
    const playlistText = playlistRes.data;

    await uploadToB2(`${videoId}/${quality}/index.m3u8`, playlistText, 'application/x-mpegURL');

    const segments = playlistText.match(/.*\.ts/g);
    if (segments) {
        for (const segmentName of segments) {
            const segmentUrl = new URL(segmentName, url).href;
            const segmentStream = await axios({ method: 'get', url: segmentUrl, responseType: 'stream' });
            await uploadToB2(`${videoId}/${quality}/${segmentName}`, segmentStream.data, 'video/MP2T');
        }
    }
}

// API ENDPOINT: POST /mirror
app.post('/mirror', async (req, res) => {
    const { videoData, videoId } = req.body;

    if (!videoData || !videoId) {
        return res.status(400).json({ error: "Missing videoData or videoId in JSON body" });
    }

    // Respond immediately so the request doesn't timeout
    res.json({ message: "Mirroring process started in background", videoId });

    // Run the processing in the background
    try {
        for (const [quality, url] of Object.entries(videoData.fast_stream_url)) {
            console.log(`Starting ${quality} for ${videoId}`);
            await mirrorHLS(quality, url, videoId);
        }
        console.log(`✅ All qualities mirrored for ${videoId}`);
    } catch (err) {
        console.error("❌ Mirroring failed:", err.message);
    }
});

// Health check for Render
app.get('/', (req, res) => res.send('HLS Mirror Server is Online'));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
