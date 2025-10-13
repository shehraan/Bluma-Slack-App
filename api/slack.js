const { App } = require('@slack/bolt');
const { OpenAI } = require('openai');
const https = require('https');
const crypto = require('crypto');
const { put } = require('@vercel/blob');
const { Client } = require('@upstash/qstash');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.BlumaAPI
});

// Initialize QStash client
const qstash = new Client({
  token: process.env.QSTASH_TOKEN,
});

// Helper function to post to Slack response_url using native https
function postToSlack(url, body) {
  return new Promise((resolve, reject) => {
    console.log('[slack] Posting delayed message to Slack response_url...');
    const bodyString = JSON.stringify(body);
    const parsedUrl = new URL(url);

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log(`[slack] Slack delayed response status: ${res.statusCode}`);
        if (data) console.log(`[slack] Slack delayed response body: ${data}`);
        resolve();
      });
    });

    req.on('error', (e) => {
      console.error('[slack] Error posting delayed message to Slack:', e);
      reject(e);
    });

    req.write(bodyString);
    req.end();
  });
}

// Helper to parse the command from Slack
function parseBlumaCommand(text) {
  text = text.trim();
  
  // Command 1: generate video [prompt]
  if (text.startsWith('generate video ')) {
    const prompt = text.substring('generate video '.length).trim();
    if (!prompt) {
      throw new Error('Please provide a prompt. Usage: `/bluma-bot generate video [your prompt]`');
    }
    return { action: 'generate', prompt };
  }
  
  // Command 2: get video [video_id]
  if (text.startsWith('get video ')) {
    const videoId = text.substring('get video '.length).trim();
    if (!videoId) {
      throw new Error('Please provide a video ID. Usage: `/bluma-bot get video [video_id]`');
    }
    return { action: 'get', videoId };
  }
  
  throw new Error('Invalid command. Use:\n• `/bluma-bot generate video [your prompt]`\n• `/bluma-bot get video [video_id]`');
}

// Generate video with user's exact prompt
async function generateVideo(prompt, response_url) {
  let generationId;

  try {
    // 1. Create the video generation job
    console.log('[slack] Calling OpenAI Videos API to start generation...');
    console.log('[slack] User prompt:', prompt);
    
    const createResponse = await fetch('https://api.openai.com/v1/videos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.BlumaAPI}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: prompt, // Use exact user prompt
        model: 'sora-2',
        size: '720x1280',
        seconds: '8'
      })
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create video job: ${createResponse.status} ${errorText}`);
    }

    const videoJob = await createResponse.json();
    generationId = videoJob.id;
    console.log(`[slack] Video job created successfully. ID: ${generationId}`);

    // 2. Poll for completion
    const maxAttempts = 180; // Poll for up to 15 minutes
    const pollInterval = 5000; // 5 seconds
    let attempt = 0;

    while (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      attempt++;
      console.log(`[slack] Polling attempt ${attempt}/${maxAttempts} for video ID: ${generationId}`);

      const statusResponse = await fetch(`https://api.openai.com/v1/videos/${generationId}`, {
        headers: { 'Authorization': `Bearer ${process.env.BlumaAPI}` }
      });

      if (!statusResponse.ok) {
        console.warn(`[slack] Status check failed (attempt ${attempt}): ${statusResponse.status}`);
        continue;
      }

      const statusData = await statusResponse.json();
      console.log(`[slack] Current video status: ${statusData.status}`);

      if (statusData.status === 'completed') {
        console.log(`[slack] Video completed! Now downloading from OpenAI...`);

        // Download the video content from OpenAI
        const videoContentResponse = await fetch(`https://api.openai.com/v1/videos/${generationId}/content`, {
          headers: { 'Authorization': `Bearer ${process.env.BlumaAPI}` }
        });

        if (!videoContentResponse.ok) {
          throw new Error(`Failed to download video content from OpenAI: ${videoContentResponse.status}`);
        }
        
        const videoBlob = await videoContentResponse.blob();
        console.log(`[slack] Video downloaded from OpenAI. Size: ${videoBlob.size} bytes.`);

        // Upload to Vercel Blob
        const filename = `bluma-video-${generationId}.mp4`;
        console.log(`[slack] Uploading video to Vercel Blob as ${filename}...`);
        
        const { url: publicUrl } = await put(filename, videoBlob, {
          access: 'public',
          contentType: 'video/mp4',
        });
        console.log(`[slack] Video uploaded to Vercel Blob. Public URL: ${publicUrl}`);

        // Notify user that video is ready with the video ID
        await postToSlack(response_url, {
          response_type: 'in_channel',
          text: `✅ *Video generation complete!*\n\n*Video ID:* \`${generationId}\`\n\nTo view your video, use:\n\`/bluma-bot get video ${generationId}\``
        });
        return; // Success
      }

      if (statusData.status === 'failed' || statusData.status === 'error') {
        throw new Error(`Video generation failed: ${statusData.error?.message || 'Unknown error'}`);
      }
    }
    
    throw new Error('Video generation timed out after 15 minutes.');

  } catch (error) {
    console.error('[slack] An error occurred during video generation:', error);
    await postToSlack(response_url, {
      response_type: 'in_channel',
      text: `❌ *Video Generation Failed*\n\n*Reason:* ${error.message}`
    });
  }
}

// Retrieve and display video from Blob storage
async function getVideo(videoId, response_url) {
  try {
    console.log(`[slack] Retrieving video ${videoId} from Blob storage...`);
    
    // Use the Vercel Blob SDK to list blobs and find our video
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: `bluma-video-${videoId}` });
    
    if (!blobs || blobs.length === 0) {
      throw new Error('Video not found in storage. Make sure it has been generated first.');
    }
    
    const blobUrl = blobs[0].url;
    console.log(`[slack] Found video in Blob storage: ${blobUrl}`);
    
    // Send the video to Slack
    await postToSlack(response_url, {
      response_type: 'in_channel',
      text: `🎬 *Your Video*\n\n*Video ID:* \`${videoId}\`\n\n<${blobUrl}|Click here to watch your video>`
    });
    
    console.log('[slack] Video sent to Slack successfully');
  } catch (error) {
    console.error('[slack] Error retrieving video:', error);
    await postToSlack(response_url, {
      response_type: 'ephemeral',
      text: `❌ *Failed to retrieve video*\n\n*Video ID:* \`${videoId}\`\n*Reason:* ${error.message}\n\nMake sure the video has been generated first.`
    });
  }
}

// Main handler for the /bluma-bot command
module.exports = async (req, res, context) => {
  try {
    const rawBody = await new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => resolve(body));
      req.on('error', err => reject(err));
    });
    
    const parsedBody = new URLSearchParams(rawBody);
    const payload = Object.fromEntries(parsedBody.entries());
    const { text, response_url } = payload;
    const parsed = parseBlumaCommand(text);

    // Handle different actions
    if (parsed.action === 'generate') {
      // Command 1: Generate video - queue the job with QStash
      
      // FIRST: Publish job to QStash (BEFORE responding to Slack)
      try {
        const callbackUrl = `https://${req.headers.host}/api/process-video`;
        console.log('[slack] Publishing job to QStash, callback URL:', callbackUrl);
        
        const result = await qstash.publishJSON({
          url: callbackUrl,
          body: {
            prompt: parsed.prompt,
            response_url: response_url
          }
        });
        
        console.log('[slack] Job published to QStash successfully, message ID:', result.messageId);
        
        // THEN: Send success acknowledgment to Slack
        res.status(200).json({
          response_type: 'in_channel',
          text: `✅ Request received! Video generation queued...\n\n*Prompt:* ${parsed.prompt}\n\nThis may take a few minutes. You'll be notified when it's ready.`
        });
        console.log('[slack] Sent acknowledgment to Slack.');
        
      } catch (error) {
        console.error('[slack] Failed to publish job to QStash:', error);
        console.error('[slack] Error details:', error.message, error.stack);
        
        // Send error response to Slack
        res.status(200).json({
          response_type: 'ephemeral',
          text: `❌ *Failed to queue video generation*\n\n*Reason:* ${error.message}\n\nPlease make sure QStash is configured correctly.`
        });
      }
      
    } else if (parsed.action === 'get') {
      // Command 2: Get video - retrieve first, then respond
      try {
        console.log('[slack] Retrieving video from Blob...');
        await getVideo(parsed.videoId, response_url);
        
        // Respond after video is retrieved
        res.status(200).json({
          response_type: 'in_channel',
          text: `✅ Video retrieved successfully!`
        });
        console.log('[slack] Acknowledged get command.');
      } catch (error) {
        console.error('[slack] Error retrieving video:', error);
        res.status(200).json({
          response_type: 'ephemeral',
          text: `❌ Failed to retrieve video: ${error.message}`
        });
      }
    }

  } catch (error) {
    console.error('Top-level handler error:', error);
    // If we haven't responded yet, send an error.
    if (!res.headersSent) {
      res.status(200).json({ 
        response_type: 'ephemeral',
        text: `*Error:* ${error.message}`
      });
    }
  }
};