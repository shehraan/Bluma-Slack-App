# Bluma Slack Bot

A Slack bot that generates viral video content using OpenAI's GPT-4 and Sora-2 models.

## Features

- **Slash Command**: `/bluma-bot generate video for [product] highlighting [feature]`
- **AI-Powered**: Uses GPT-4 for video concepts and Sora-2 for video generation
- **Fast Response**: Video ideas generated instantly, videos within 5 minutes
- **Slack Integration**: Native Slack experience with rich formatting

## Prerequisites

- Vercel account (recommended) or AWS account
- Slack workspace with admin access
- OpenAI API key with Sora-2 access

## Setup

### 1. Environment Variables

Create a `.env` file with the following variables:

```bash
# Slack Bot Configuration
BotToken=xoxb-your-bot-token-here
SigningSecret=your-signing-secret-here
ClientSecret=your-client-secret-here

# OpenAI Configuration
BlumaAPI=your-openai-api-key-here
```

### 2. Deploy to Vercel

#### Option A: Using Vercel CLI (Recommended)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod

# Set environment variables in Vercel dashboard
# Go to your project settings and add the environment variables
```

#### Option B: Using Vercel Dashboard

1. Connect your GitHub repository to Vercel
2. Import the project
3. Add environment variables in project settings
4. Deploy

### 3. Configure Slack App

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Select your existing Bluma app
3. Navigate to **Slash Commands**
4. Add a new command:
   - **Command**: `/bluma-bot`
   - **Request URL**: `https://your-vercel-app.vercel.app/api/slack`
   - **Short Description**: Generate viral video content
   - **Usage Hint**: `generate video for [product] highlighting [feature]`

5. Navigate to **OAuth & Permissions**
6. Add these Bot Token Scopes:
   - `commands` - For slash commands
   - `chat:write` - To send messages
   - `app_mentions:read` - To handle mentions

7. Navigate to **Event Subscriptions**
8. Enable Events and set Request URL: `https://your-vercel-app.vercel.app/api/slack`
9. Subscribe to bot events: `app_mention`

### 4. Install Bot in Workspace

1. Go to **Install App** in your Slack app settings
2. Install to your workspace
3. Copy the **Bot User OAuth Token** to your `.env` file as `BotToken`

## Usage

In your Slack workspace:

```
/bluma-bot generate video for CRM Software highlighting automated lead scoring
```

Expected behavior:
1. Immediate acknowledgment
2. Video idea generated and shared
3. Video creation starts
4. Final video shared (within 5 minutes)

## Troubleshooting

### Common Issues

1. **"Command not found"**
   - Check if slash command is properly configured
   - Verify Request URL is correct

2. **"Bot not responding"**
   - Check Vercel deployment logs
   - Verify environment variables are set
   - Check OpenAI API key validity

3. **"Video generation failed"**
   - Verify Sora-2 model access
   - Check OpenAI API rate limits
   - Review error logs in Vercel

### Debugging

1. **Check Vercel Logs**:
   ```bash
   vercel logs your-deployment-url
   ```

2. **Test Locally**:
   ```bash
   # Activate virtual environment
   source venv/bin/activate
   
   # Start local server
   python api/slack.py
   ```

3. **Monitor API Usage**:
   - Check OpenAI dashboard for usage
   - Monitor Slack API rate limits

## Development

### Local Testing

```bash
pip install -r requirements.txt
python api/slack.py
```

### Project Structure

```
├── api/
│   ├── config.py          # Configuration module
│   ├── requirements.txt   # Python dependencies
│   └── slack.py          # Main bot handler
├── .cursor/rules/        # Development guidelines
├── package.json          # Node.js configuration
├── .vercelignore         # Vercel ignore file
└── README.md            # This file
```