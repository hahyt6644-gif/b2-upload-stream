const express = require('express');
const axios = require('axios');
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const app = express();
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

// Reusable upload function
async function uploadToB2(key, body, contentType) {
    const upload = new Upload({
        client: s3Client,
        params: { Bucket: "tera-stream-itz", Key: key, Body: body, ContentType: contentType },
    });
    return upload.done();
}

// The route that triggers the work
app.get('/start-mirror', async (req, res) => {
    res.send("Mirroring started in the background...");

    // Your logic here
    const videoData = { /* YOUR JSON */ };
    const videoId = "Update_20231215";

    try {
        for (const [quality, url] of Object.entries(videoData.fast_stream_url)) {
            // ... (Your mirrorHLS logic)
        }
        console.log("✅ Mirroring Complete!");
    } catch (err) {
        console.error("❌ Error:", err);
    }
});

// Basic health check so Render knows the app is alive
app.get('/', (req, res) => res.send('Server is running!'));

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
